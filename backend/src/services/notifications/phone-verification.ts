// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from '../../db/knex.js';
import { BadRequest, Conflict, NotFound, Unauthorized } from '../../http/errors.js';
import { getResolvedDisplayName } from '../appliance-settings.js';
import { normalizeToE164 } from './phone-number.js';
import { notify } from './service.js';

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  // Cryptographically random 6-digit code.
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, '0');
}

export async function startPhoneVerification(
  companyId: number,
  employeeId: number,
  phoneRaw: string,
): Promise<{ expiresAt: string }> {
  // Same normalization as user-level phones — TextLinkSMS's paired
  // Android SIM drops messages that omit the country prefix, and
  // Twilio rejects non-E.164. Either way, canonicalize once at the
  // boundary.
  const phone = normalizeToE164(phoneRaw);
  return db.transaction(async (trx) => {
    const employee = await trx('employees')
      .where({ id: employeeId, company_id: companyId, status: 'active' })
      .first<{ id: number; first_name: string; last_name: string }>();
    if (!employee) throw NotFound('Employee not found');

    // Replace any prior unverified attempt — only one active verification
    // per employee at a time, per the partial unique index.
    await trx('phone_verifications')
      .where({ employee_id: employeeId })
      .whereNull('verified_at')
      .delete();

    const code = generateCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    await trx('phone_verifications').insert({
      employee_id: employeeId,
      company_id: companyId,
      code_hash: codeHash,
      phone,
      expires_at: expiresAt,
    });

    // Store the new phone on the employee record (unverified until the
    // code is confirmed).
    await trx('employees').where({ id: employeeId }).update({
      phone,
      phone_verified_at: null,
      updated_at: trx.fn.now(),
    });

    // Send the code via SMS. The channel bypass is intentional here —
    // we ignore the employee's smsOptIn and phoneVerified gates because
    // the whole point of this flow is to opt in and verify.
    const result = await notify({
      companyId,
      type: 'phone_verification',
      recipient: {
        kind: 'employee',
        id: employee.id,
        email: null,
        phone,
        emailOptIn: false,
        smsOptIn: true,
        phoneVerified: true, // override the usual gate just for this flow
      },
      vars: { appName: await getResolvedDisplayName(), code },
      channels: ['sms'],
    });
    // notify() records failures instead of throwing. The person is waiting
    // on this code, so a send that didn't go out is an error they see —
    // and it rolls back the code and the unverified number with it.
    if (result.sms?.status !== 'sent') {
      throw BadRequest(
        `The verification code could not be sent: ${result.sms?.error ?? result.sms?.status ?? 'no SMS provider'}`,
      );
    }

    return { expiresAt: expiresAt.toISOString() };
  });
}

export async function confirmPhoneVerification(
  companyId: number,
  employeeId: number,
  code: string,
): Promise<void> {
  return db.transaction(async (trx) => {
    const row = await trx('phone_verifications')
      .where({ employee_id: employeeId, company_id: companyId })
      .whereNull('verified_at')
      .forUpdate()
      .first<{
        id: number;
        code_hash: string;
        expires_at: Date;
        attempts: number;
      }>();
    if (!row) throw NotFound('No pending verification — request a new code');
    if (row.expires_at.getTime() < Date.now()) throw Conflict('Verification code expired');
    if (row.attempts >= MAX_ATTEMPTS) throw Unauthorized('Too many attempts; request a new code');

    const ok = await bcrypt.compare(code, row.code_hash);
    if (!ok) {
      await trx('phone_verifications')
        .where({ id: row.id })
        .update({ attempts: row.attempts + 1 });
      throw Unauthorized('Invalid code');
    }

    await trx('phone_verifications').where({ id: row.id }).update({
      verified_at: trx.fn.now(),
    });
    await trx('employees').where({ id: employeeId }).update({
      phone_verified_at: trx.fn.now(),
      sms_notifications_enabled: true,
      updated_at: trx.fn.now(),
    });
  });
}

export function assertValidPhone(phone: string): void {
  if (!/^\+?[\d\s().-]{7,32}$/.test(phone)) {
    throw BadRequest('Phone number looks invalid');
  }
}

export { normalizeToE164 } from './phone-number.js';
