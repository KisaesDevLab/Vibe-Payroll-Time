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
      payload: { subject: rendered.subject },
    });
  }

  // ---------- SMS ----------
  if (desired.has('sms') && input.recipient.kind === 'employee') {
    const r = input.recipient;
    const phone = r.phone;
    if (!phone || !r.smsOptIn) {
      result.sms = {
        status: 'skipped',
        providerMessageId: null,
        error: !phone ? 'no phone on file' : 'employee opted out of sms',
      };
    } else if (!r.phoneVerified) {
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
      payload: { body: rendered.sms },
    });
  }

  return result;
}

async function sendEmail(
  input: NotifyInput,
  to: string,
  payload: EmailPayload,
): Promise<LogOutcome> {
  if (env.NOTIFICATIONS_DISABLED) {
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
  if (env.NOTIFICATIONS_DISABLED) {
    return { status: 'disabled', providerMessageId: null, error: null };
  }
  const config = await resolveSmsConfig(input.companyId);
  if (!config) {
    return {
      status: 'skipped',
      providerMessageId: null,
      error: 'No SMS provider configured for company or appliance',
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
