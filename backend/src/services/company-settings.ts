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
  twilio_account_sid: string | null;
  twilio_auth_token_encrypted: string | null;
  twilio_from_number: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_user: string | null;
  smtp_pass_encrypted: string | null;
  smtp_from: string | null;
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
    twilioAccountSid: row.twilio_account_sid,
    twilioFromNumber: row.twilio_from_number,
    twilioAuthTokenConfigured: !!row.twilio_auth_token_encrypted,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpUser: row.smtp_user,
    smtpFrom: row.smtp_from,
    smtpPasswordConfigured: !!row.smtp_pass_encrypted,
  };
}

export async function getCompanySettings(companyId: number): Promise<CompanySettings> {
  const row = await db<SettingsRow>('company_settings').where({ company_id: companyId }).first();
  if (!row) throw NotFound('Company settings not found');
  return rowToSettings(row);
}

/**
 * Partial patch. Secret fields (`twilioAuthToken`, `smtpPassword`) follow
 * three-state semantics:
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
    if (patch.allowSelfApprove !== undefined)
      updates.allow_self_approve = patch.allowSelfApprove;
    if (patch.kioskEnabled !== undefined) updates.kiosk_enabled = patch.kioskEnabled;
    if (patch.personalDeviceEnabled !== undefined)
      updates.personal_device_enabled = patch.personalDeviceEnabled;

    if (patch.twilioAccountSid !== undefined) updates.twilio_account_sid = patch.twilioAccountSid;
    if (patch.twilioFromNumber !== undefined) updates.twilio_from_number = patch.twilioFromNumber;
    if (patch.smtpHost !== undefined) updates.smtp_host = patch.smtpHost;
    if (patch.smtpPort !== undefined) updates.smtp_port = patch.smtpPort;
    if (patch.smtpUser !== undefined) updates.smtp_user = patch.smtpUser;
    if (patch.smtpFrom !== undefined) updates.smtp_from = patch.smtpFrom;

    if ('twilioAuthToken' in patch) {
      updates.twilio_auth_token_encrypted =
        patch.twilioAuthToken === null ? null : encryptSecret(patch.twilioAuthToken as string);
    }
    if ('smtpPassword' in patch) {
      updates.smtp_pass_encrypted =
        patch.smtpPassword === null ? null : encryptSecret(patch.smtpPassword as string);
    }

    await trx('company_settings').where({ company_id: companyId }).update(updates);

    const fresh = await trx<SettingsRow>('company_settings')
      .where({ company_id: companyId })
      .first();
    if (!fresh) throw new Error('settings row vanished');
    return rowToSettings(fresh);
  });
}
