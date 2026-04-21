import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound, Unauthorized } from '../http/errors.js';
import { getResolvedDisplayName, getResolvedSmsProvider } from './appliance-settings.js';
import { sendViaTextLinkSms } from './notifications/textlinksms-client.js';
import { sendViaTwilio } from './notifications/twilio-client.js';
import { normalizeToE164 } from './notifications/phone-verification.js';

/**
 * User-level (appliance-wide) phone management.
 *
 * Parallel to the per-employee `phone-verification.ts` flow, but:
 *   - Writes to `users.phone` / `users.phone_verified_at` (not
 *     `employees.phone`), so the same row serves every company the
 *     user is a member of.
 *   - Sends the code via the appliance-level SMS provider (not the
 *     company-level provider), so SuperAdmins don't need a company
 *     context to verify.
 *
 * Used by /me/phone/* endpoints on /preferences.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 1_000_000;
  return num.toString().padStart(6, '0');
}

/**
 * Set the user's phone number. Does NOT send a code — that's a
 * separate endpoint so the caller can confirm the number looks right
 * before spending an SMS.
 * Changing the number clears any prior verification + wipes any
 * outstanding challenge.
 */
export async function setUserPhone(userId: number, phone: string | null): Promise<void> {
  // Store in canonical E.164. Without this, TextLinkSMS silently
  // fails to deliver because the paired Android SIM can't route
  // numbers that omit the country prefix.
  const normalized = phone === null ? null : normalizeToE164(phone);
  await db.transaction(async (trx) => {
    const user = await trx('users').where({ id: userId }).first<{ phone: string | null }>();
    if (!user) throw NotFound('User not found');
    const changed = (user.phone ?? null) !== (normalized ?? null);
    await trx('users')
      .where({ id: userId })
      .update({
        phone: normalized,
        // Any change invalidates prior verification + outstanding codes.
        ...(changed
          ? {
              phone_verified_at: null,
              phone_verify_code_hash: null,
              phone_verify_expires_at: null,
              phone_verify_attempts: 0,
            }
          : {}),
        updated_at: trx.fn.now(),
      });
  });
}

/**
 * Mint a fresh 6-digit code for the user's current phone and send it
 * via the appliance-level SMS provider. Throws if no phone is set, or
 * if the appliance has no SMS provider configured.
 */
export async function requestUserPhoneVerification(userId: number): Promise<{ expiresAt: string }> {
  const user = await db('users')
    .where({ id: userId })
    .first<{ id: number; phone: string | null; email: string }>();
  if (!user) throw NotFound('User not found');
  if (!user.phone) throw BadRequest('No phone number set — save a number before requesting a code');

  const resolved = await getResolvedSmsProvider();
  if (!resolved.provider) {
    throw BadRequest(
      'The appliance has no SMS provider configured. Ask a SuperAdmin to set Twilio or TextLinkSMS in Appliance Settings.',
    );
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await db('users').where({ id: userId }).update({
    phone_verify_code_hash: codeHash,
    phone_verify_expires_at: expiresAt,
    phone_verify_attempts: 0,
    updated_at: db.fn.now(),
  });

  const appName = await getResolvedDisplayName();
  const body = `Your ${appName} verification code is ${code}. Expires in 10 minutes.`;

  // Dispatch via the appliance-level provider. Parallels
  // notifications/service.ts#sendSms but bypasses per-company resolver
  // because user.phone is appliance-scoped.
  if (resolved.provider === 'twilio') {
    if (!resolved.twilio) {
      throw BadRequest('Twilio selected on the appliance but credentials are incomplete');
    }
    await sendViaTwilio(resolved.twilio, { to: user.phone, body });
  } else {
    if (!resolved.textlinksms) {
      throw BadRequest('TextLinkSMS selected on the appliance but credentials are incomplete');
    }
    await sendViaTextLinkSms(resolved.textlinksms, { to: user.phone, body });
  }

  return { expiresAt: expiresAt.toISOString() };
}

export async function confirmUserPhoneVerification(userId: number, code: string): Promise<void> {
  await db.transaction(async (trx) => {
    const row = await trx('users').where({ id: userId }).forUpdate().first<{
      phone: string | null;
      phone_verify_code_hash: string | null;
      phone_verify_expires_at: Date | null;
      phone_verify_attempts: number;
    }>();
    if (!row) throw NotFound('User not found');
    if (!row.phone_verify_code_hash || !row.phone_verify_expires_at) {
      throw NotFound('No pending verification — request a new code');
    }
    if (row.phone_verify_expires_at.getTime() < Date.now()) {
      throw Conflict('Verification code expired');
    }
    if (row.phone_verify_attempts >= MAX_ATTEMPTS) {
      throw Unauthorized('Too many attempts; request a new code');
    }

    const ok = await bcrypt.compare(code, row.phone_verify_code_hash);
    if (!ok) {
      await trx('users')
        .where({ id: userId })
        .update({ phone_verify_attempts: row.phone_verify_attempts + 1 });
      throw Unauthorized('Invalid code');
    }

    await trx('users').where({ id: userId }).update({
      phone_verified_at: trx.fn.now(),
      phone_verify_code_hash: null,
      phone_verify_expires_at: null,
      phone_verify_attempts: 0,
      updated_at: trx.fn.now(),
    });
  });
}
