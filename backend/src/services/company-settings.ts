// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { CompanySettings, UpdateCompanySettingsRequest } from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';
import { encryptSecret } from './crypto.js';

interface SettingsRow {
  company_id: number;
  punch_rounding_mode: CompanySettings['punchRoundingMode'];
  punch_rounding_grace_minutes: number;
  auto_clockout_hours: number;
  missed_punch_reminder_hours: number;
  supervisor_approval_required: boolean;
  allow_self_approve: boolean;
  kiosk_enabled: boolean;
  personal_device_enabled: boolean;
  kiosk_auth_mode: CompanySettings['kioskAuthMode'];
  twilio_account_sid: string | null;
  twilio_auth_token_encrypted: string | null;
  twilio_from_number: string | null;
  emailit_api_key_encrypted: string | null;
  emailit_from_email: string | null;
  emailit_from_name: string | null;
  emailit_reply_to: string | null;
}

function rowToSettings(row: SettingsRow): CompanySettings {
  return {
    companyId: row.company_id,
    punchRoundingMode: row.punch_rounding_mode,
    punchRoundingGraceMinutes: row.punch_rounding_grace_minutes,
    autoClockoutHours: row.auto_clockout_hours,
    missedPunchReminderHours: row.missed_punch_reminder_hours,
    supervisorApprovalRequired: row.supervisor_approval_required,
    allowSelfApprove: row.allow_self_approve,
    kioskEnabled: row.kiosk_enabled,
    personalDeviceEnabled: row.personal_device_enabled,
    kioskAuthMode: row.kiosk_auth_mode,
    twilioAccountSid: row.twilio_account_sid,
    twilioFromNumber: row.twilio_from_number,
    twilioAuthTokenConfigured: !!row.twilio_auth_token_encrypted,
    emailitFromEmail: row.emailit_from_email,
    emailitFromName: row.emailit_from_name,
    emailitReplyTo: row.emailit_reply_to,
    emailitApiKeyConfigured: !!row.emailit_api_key_encrypted,
  };
}

export async function getCompanySettings(companyId: number): Promise<CompanySettings> {
  const row = await db<SettingsRow>('company_settings').where({ company_id: companyId }).first();
  if (!row) throw NotFound('Company settings not found');
  return rowToSettings(row);
}

/**
 * Partial patch. Secret fields (`twilioAuthToken`, `emailitApiKey`)
 * follow three-state semantics:
 *   - omitted   → leave the existing encrypted blob untouched
 *   - null      → clear (set column to NULL)
 *   - string    → encrypt + store
 */
export async function updateCompanySettings(
  companyId: number,
  patch: UpdateCompanySettingsRequest,
): Promise<CompanySettings> {
  return db.transaction(async (trx) => {
    const current = await trx<SettingsRow>('company_settings')
      .where({ company_id: companyId })
      .first();
    if (!current) throw NotFound('Company settings not found');

    const updates: Partial<SettingsRow> & { updated_at?: unknown } = {
      updated_at: trx.fn.now(),
    };

    if (patch.punchRoundingMode !== undefined)
      updates.punch_rounding_mode = patch.punchRoundingMode;
    if (patch.punchRoundingGraceMinutes !== undefined)
      updates.punch_rounding_grace_minutes = patch.punchRoundingGraceMinutes;
    if (patch.autoClockoutHours !== undefined)
      updates.auto_clockout_hours = patch.autoClockoutHours;
    if (patch.missedPunchReminderHours !== undefined)
      updates.missed_punch_reminder_hours = patch.missedPunchReminderHours;
    if (patch.supervisorApprovalRequired !== undefined)
      updates.supervisor_approval_required = patch.supervisorApprovalRequired;
    if (patch.allowSelfApprove !== undefined) updates.allow_self_approve = patch.allowSelfApprove;
    if (patch.kioskEnabled !== undefined) updates.kiosk_enabled = patch.kioskEnabled;
    if (patch.personalDeviceEnabled !== undefined)
      updates.personal_device_enabled = patch.personalDeviceEnabled;
    if (patch.kioskAuthMode !== undefined) updates.kiosk_auth_mode = patch.kioskAuthMode;

    if (patch.twilioAccountSid !== undefined) updates.twilio_account_sid = patch.twilioAccountSid;
    if (patch.twilioFromNumber !== undefined) updates.twilio_from_number = patch.twilioFromNumber;
    if (patch.emailitFromEmail !== undefined) updates.emailit_from_email = patch.emailitFromEmail;
    if (patch.emailitFromName !== undefined) updates.emailit_from_name = patch.emailitFromName;
    if (patch.emailitReplyTo !== undefined) updates.emailit_reply_to = patch.emailitReplyTo;

    if ('twilioAuthToken' in patch) {
      updates.twilio_auth_token_encrypted =
        patch.twilioAuthToken === null ? null : encryptSecret(patch.twilioAuthToken as string);
    }
    if ('emailitApiKey' in patch) {
      updates.emailit_api_key_encrypted =
        patch.emailitApiKey === null ? null : encryptSecret(patch.emailitApiKey as string);
    }

    await trx('company_settings').where({ company_id: companyId }).update(updates);

    const fresh = await trx<SettingsRow>('company_settings')
      .where({ company_id: companyId })
      .first();
    if (!fresh) throw new Error('settings row vanished');
    return rowToSettings(fresh);
  });
}
