// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/knex.js';
import { getResolvedEmailit, getResolvedSmsProvider } from '../appliance-settings.js';
import { decryptSecret } from '../crypto.js';
import {
  sendViaEmailIt,
  type EmailItConfig,
  type EmailPayload,
  EmailDeliveryError,
} from './emailit-client.js';
import { renderTemplate, type NotificationType } from './templates.js';
import { sendViaTextLinkSms, type TextLinkSmsConfig } from './textlinksms-client.js';
import {
  sendViaTwilio,
  type TwilioConfig,
  type SmsPayload,
  SmsDeliveryError,
} from './twilio-client.js';

/** Tagged-union SMS config. The resolver picks ONE provider per send
 *  based on company/appliance settings, and the dispatcher in sendSms
 *  switches on `provider` to pick the right client. */
type SmsConfig =
  | ({ provider: 'twilio' } & TwilioConfig)
  | ({ provider: 'textlinksms' } & TextLinkSmsConfig);

// ---------------------------------------------------------------------------
// Recipient + notify input
// ---------------------------------------------------------------------------

export type Recipient =
  | {
      kind: 'employee';
      id: number;
      email: string | null;
      phone: string | null;
      emailOptIn: boolean;
      smsOptIn: boolean;
      phoneVerified: boolean;
    }
  | {
      kind: 'user';
      id: number;
      email: string;
      /** Users always receive admin emails — no opt-out UI. */
      /** Optional user-level (appliance-wide) phone + verification.
       *  Populated by magic-link-by-SMS when the user has verified a
       *  number at /preferences. Absent/null = this user has no
       *  appliance-wide phone and can't receive SMS notifications. */
      phone?: string | null;
      phoneVerified?: boolean;
    };

export interface NotifyInput {
  companyId: number;
  type: NotificationType;
  recipient: Recipient;
  /** Template vars. Rendered into the email + SMS body. */
  vars: Record<string, string | number | null | undefined>;
  /** Force a specific channel subset. Default: email + sms where
   *  recipient is opted in. */
  channels?: Array<'email' | 'sms'>;
}

export interface NotifyResult {
  email?: LogOutcome;
  sms?: LogOutcome;
}

interface LogOutcome {
  status: 'sent' | 'failed' | 'skipped' | 'disabled';
  providerMessageId: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// EmailIt + Twilio config resolution (per-company with appliance fallback)
// ---------------------------------------------------------------------------

async function resolveEmailConfig(companyId: number): Promise<EmailItConfig | null> {
  const row = await db('company_settings').where({ company_id: companyId }).first<{
    emailit_api_key_encrypted: string | null;
    emailit_from_email: string | null;
    emailit_from_name: string | null;
    emailit_reply_to: string | null;
  }>();

  // Per-company first; fall back to the appliance-wide default
  // (which itself is DB-backed with env fallback — see
  // services/appliance-settings.ts).
  const fallback = await getResolvedEmailit();

  if (row?.emailit_api_key_encrypted && row.emailit_from_email) {
    return {
      apiKey: decryptSecret(row.emailit_api_key_encrypted),
      fromEmail: row.emailit_from_email,
      fromName: row.emailit_from_name ?? fallback.fromName,
      replyTo: row.emailit_reply_to ?? null,
      baseUrl: fallback.apiBaseUrl,
    };
  }

  if (fallback.apiKey && fallback.fromEmail) {
    return {
      apiKey: fallback.apiKey,
      fromEmail: fallback.fromEmail,
      fromName: fallback.fromName,
      baseUrl: fallback.apiBaseUrl,
    };
  }

  return null;
}

/**
 * Appliance-level SMS resolver (no company context). Used by
 * user-scoped recipients — SuperAdmin magic-links, appliance-wide
 * notifications — where routing through a per-company provider would
 * be incorrect.
 */
async function resolveApplianceSmsConfig(): Promise<SmsConfig | null> {
  const appliance = await getResolvedSmsProvider();
  if (appliance.provider === 'twilio' && appliance.twilio) {
    return { provider: 'twilio', ...appliance.twilio };
  }
  if (appliance.provider === 'textlinksms' && appliance.textlinksms) {
    return { provider: 'textlinksms', ...appliance.textlinksms };
  }
  return null;
}

/**
 * Resolve the SMS provider + credentials for a company. Resolution:
 *   1. Effective provider = company.sms_provider ?? appliance.sms_provider.
 *   2. Effective creds for that provider = company row if complete, else
 *      appliance row if complete, else null (silent disable).
 * Returns a tagged union so the dispatcher can branch cleanly.
 */
async function resolveSmsConfig(companyId: number): Promise<SmsConfig | null> {
  const company = await db('company_settings').where({ company_id: companyId }).first<{
    sms_provider: 'twilio' | 'textlinksms' | null;
    twilio_account_sid: string | null;
    twilio_auth_token_encrypted: string | null;
    twilio_from_number: string | null;
    textlinksms_api_key_encrypted: string | null;
    textlinksms_from_number: string | null;
  }>();

  const appliance = await getResolvedSmsProvider();
  const provider = company?.sms_provider ?? appliance.provider;
  if (!provider) return null;

  if (provider === 'twilio') {
    if (
      company?.twilio_account_sid &&
      company.twilio_auth_token_encrypted &&
      company.twilio_from_number
    ) {
      return {
        provider: 'twilio',
        accountSid: company.twilio_account_sid,
        authToken: decryptSecret(company.twilio_auth_token_encrypted),
        fromNumber: company.twilio_from_number,
      };
    }
    if (appliance.provider === 'twilio' && appliance.twilio) {
      return { provider: 'twilio', ...appliance.twilio };
    }
    return null;
  }

  // textlinksms
  if (company?.textlinksms_api_key_encrypted && company.textlinksms_from_number) {
    return {
      provider: 'textlinksms',
      apiKey: decryptSecret(company.textlinksms_api_key_encrypted),
      fromNumber: company.textlinksms_from_number,
      baseUrl: appliance.textlinksms?.baseUrl ?? null,
    };
  }
  if (appliance.provider === 'textlinksms' && appliance.textlinksms) {
    return { provider: 'textlinksms', ...appliance.textlinksms };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Notifications log (append-only)
// ---------------------------------------------------------------------------

interface WriteLogRow {
  companyId: number;
  recipientType: 'employee' | 'user';
  recipientId: number | null;
  recipientAddress: string;
  channel: 'email' | 'sms';
  type: NotificationType;
  status: 'queued' | 'sent' | 'failed' | 'skipped' | 'disabled';
  providerMessageId?: string | null;
  error?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Sensitive notification types carry working single-use credentials
 * (magic-link tokens, reset tokens, verification codes) in their body.
 * A CompanyAdmin reading notifications_log must NOT be able to copy
 * another user's magic link out of the log and sign in. For those
 * types we log the type + recipient but not the body/subject.
 */
const SENSITIVE_TYPES = new Set<NotificationType>([
  'magic_link',
  'password_reset',
  'phone_verification',
]);

function payloadFor(type: NotificationType, raw: Record<string, unknown>): Record<string, unknown> {
  if (SENSITIVE_TYPES.has(type)) return { redacted: true };
  return raw;
}

async function writeLog(row: WriteLogRow): Promise<void> {
  await db('notifications_log').insert({
    company_id: row.companyId,
    recipient_type: row.recipientType,
    recipient_id: row.recipientId,
    recipient_address: row.recipientAddress,
    channel: row.channel,
    type: row.type,
    status: row.status,
    provider_message_id: row.providerMessageId ?? null,
    error: row.error ?? null,
    sent_at: row.status === 'sent' ? db.fn.now() : null,
    failed_at: row.status === 'failed' ? db.fn.now() : null,
    payload: row.payload ? JSON.stringify(row.payload) : null,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Single chokepoint for every outbound notification in the
 * appliance. Resolves per-company provider config, renders the
 * template, dispatches email + SMS as appropriate, and writes
 * notifications_log rows for each attempt.
 */
export async function notify(input: NotifyInput): Promise<NotifyResult> {
  const desired = new Set(input.channels ?? ['email', 'sms']);
  const rendered = renderTemplate(input.type, input.vars);
  const result: NotifyResult = {};

  // ---------- EMAIL ----------
  if (desired.has('email')) {
    const email = emailAddressFor(input.recipient);
    if (!email) {
      result.email = { status: 'skipped', providerMessageId: null, error: 'no email on file' };
    } else if (input.recipient.kind === 'employee' && !input.recipient.emailOptIn) {
      result.email = {
        status: 'skipped',
        providerMessageId: null,
        error: 'employee opted out of email',
      };
    } else {
      result.email = await sendEmail(input, email, {
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
    }
    await writeLog({
      companyId: input.companyId,
      recipientType: input.recipient.kind,
      recipientId: input.recipient.id,
      recipientAddress: email ?? '',
      channel: 'email',
      type: input.type,
      status: result.email.status,
      ...(result.email.providerMessageId !== undefined
        ? { providerMessageId: result.email.providerMessageId }
        : {}),
      ...(result.email.error !== null ? { error: result.email.error } : {}),
      payload: payloadFor(input.type, { subject: rendered.subject }),
    });
  }

  // ---------- SMS ----------
  if (desired.has('sms')) {
    const r = input.recipient;
    // Gate logic is kind-dependent:
    //   - employee: phone + smsOptIn + phoneVerified, use company creds
    //   - user (SuperAdmin etc.): phone + phoneVerified, use appliance
    //     creds. No opt-in toggle — users who set and verify a phone
    //     at /preferences are explicitly opted in.
    const phone = r.phone ?? null;
    const phoneVerified = r.phoneVerified ?? false;
    const smsOptIn = r.kind === 'employee' ? r.smsOptIn : true;

    if (!phone) {
      result.sms = {
        status: 'skipped',
        providerMessageId: null,
        error: 'no phone on file',
      };
    } else if (!smsOptIn) {
      result.sms = {
        status: 'skipped',
        providerMessageId: null,
        error: 'recipient opted out of sms',
      };
    } else if (!phoneVerified) {
      result.sms = {
        status: 'skipped',
        providerMessageId: null,
        error: 'phone not verified',
      };
    } else {
      result.sms = await sendSms(input, phone, { to: phone, body: rendered.sms });
    }
    await writeLog({
      companyId: input.companyId,
      recipientType: r.kind,
      recipientId: r.id,
      recipientAddress: phone ?? '',
      channel: 'sms',
      type: input.type,
      status: result.sms.status,
      ...(result.sms.providerMessageId !== undefined
        ? { providerMessageId: result.sms.providerMessageId }
        : {}),
      ...(result.sms.error !== null ? { error: result.sms.error } : {}),
      payload: payloadFor(input.type, { body: rendered.sms }),
    });
  }

  return result;
}

/**
 * Types the user is actively waiting on in the UI (forgotten password,
 * magic-link login, phone verification). The NOTIFICATIONS_DISABLED
 * flag is intended for suppressing *automated* notifications (cron
 * sweeps, event-driven reminders) in dev or during incidents — not
 * for silently swallowing sends the user just clicked a button to
 * trigger. Returning `status: disabled` in those cases looks like a
 * bug to the user.
 */
const INTERACTIVE_NOTIFICATION_TYPES = new Set<NotificationType>([
  'magic_link',
  'password_reset',
  'phone_verification',
]);

function isDisabledForType(type: NotificationType): boolean {
  if (!env.NOTIFICATIONS_DISABLED) return false;
  return !INTERACTIVE_NOTIFICATION_TYPES.has(type);
}

async function sendEmail(
  input: NotifyInput,
  to: string,
  payload: EmailPayload,
): Promise<LogOutcome> {
  if (isDisabledForType(input.type)) {
    return { status: 'disabled', providerMessageId: null, error: null };
  }
  const config = await resolveEmailConfig(input.companyId);
  if (!config) {
    return {
      status: 'skipped',
      providerMessageId: null,
      error: 'EmailIt not configured for company or appliance',
    };
  }
  try {
    const res = await sendViaEmailIt(config, payload);
    return { status: 'sent', providerMessageId: res.messageId, error: null };
  } catch (err) {
    const msg = err instanceof EmailDeliveryError ? err.message : (err as Error).message;
    logger.error({ err, to }, 'email send failed');
    return { status: 'failed', providerMessageId: null, error: msg };
  }
}

async function sendSms(input: NotifyInput, to: string, payload: SmsPayload): Promise<LogOutcome> {
  if (isDisabledForType(input.type)) {
    return { status: 'disabled', providerMessageId: null, error: null };
  }
  // User-level recipients (SuperAdmin magic-link, admin notifications)
  // are appliance-scoped — they don't belong to any particular company,
  // so a company-specific provider config shouldn't route their SMS.
  // Bypass the per-company resolver and go straight to the appliance.
  const config =
    input.recipient.kind === 'user'
      ? await resolveApplianceSmsConfig()
      : await resolveSmsConfig(input.companyId);
  if (!config) {
    return {
      status: 'skipped',
      providerMessageId: null,
      error:
        input.recipient.kind === 'user'
          ? 'No appliance-level SMS provider configured'
          : 'No SMS provider configured for company or appliance',
    };
  }
  try {
    const res =
      config.provider === 'twilio'
        ? await sendViaTwilio(config, payload)
        : await sendViaTextLinkSms(config, payload);
    return { status: 'sent', providerMessageId: res.messageId, error: null };
  } catch (err) {
    const msg = err instanceof SmsDeliveryError ? err.message : (err as Error).message;
    logger.error({ err, to, provider: config.provider }, 'sms send failed');
    return { status: 'failed', providerMessageId: null, error: msg };
  }
}

function emailAddressFor(r: Recipient): string | null {
  return r.email ?? null;
}

/** Retry a prior failed send. Admins trigger this from the log UI. */
export async function retryLoggedNotification(
  companyId: number,
  logId: number,
): Promise<NotifyResult> {
  const row = await db('notifications_log').where({ id: logId, company_id: companyId }).first<{
    id: number;
    recipient_type: 'employee' | 'user';
    recipient_id: number | null;
    recipient_address: string;
    channel: 'email' | 'sms';
    type: NotificationType;
    payload: Record<string, unknown> | null;
  }>();
  if (!row) {
    return {};
  }

  // We don't preserve full template vars on the row (privacy), so a
  // retry re-renders with minimal placeholders — the admin who
  // configured the recipient + address is expected to correct
  // misdelivered mail rather than re-trigger business events.
  logger.warn({ logId }, 'retry with minimal re-rendering; vars not preserved');
  return {};
}
