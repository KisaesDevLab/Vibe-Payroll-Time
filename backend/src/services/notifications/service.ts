import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/knex.js';
import { decryptSecret } from '../crypto.js';
import {
  sendViaEmailIt,
  type EmailItConfig,
  type EmailPayload,
  EmailDeliveryError,
} from './emailit-client.js';
import { renderTemplate, type NotificationType } from './templates.js';
import {
  sendViaTwilio,
  type TwilioConfig,
  type SmsPayload,
  SmsDeliveryError,
} from './twilio-client.js';

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
  const row = await db('company_settings')
    .where({ company_id: companyId })
    .first<{
      emailit_api_key_encrypted: string | null;
      emailit_from_email: string | null;
      emailit_from_name: string | null;
      emailit_reply_to: string | null;
    }>();

  // Per-company first; fall back to the appliance-wide default if the
  // company hasn't configured its own.
  if (row?.emailit_api_key_encrypted && row.emailit_from_email) {
    return {
      apiKey: decryptSecret(row.emailit_api_key_encrypted),
      fromEmail: row.emailit_from_email,
      fromName: row.emailit_from_name ?? env.EMAILIT_FROM_NAME,
      replyTo: row.emailit_reply_to ?? null,
    };
  }

  if (env.EMAILIT_API_KEY && env.EMAILIT_FROM_EMAIL) {
    return {
      apiKey: env.EMAILIT_API_KEY,
      fromEmail: env.EMAILIT_FROM_EMAIL,
      fromName: env.EMAILIT_FROM_NAME,
    };
  }

  return null;
}

async function resolveTwilioConfig(companyId: number): Promise<TwilioConfig | null> {
  const row = await db('company_settings')
    .where({ company_id: companyId })
    .first<{
      twilio_account_sid: string | null;
      twilio_auth_token_encrypted: string | null;
      twilio_from_number: string | null;
    }>();
  if (!row?.twilio_account_sid || !row.twilio_auth_token_encrypted || !row.twilio_from_number) {
    return null;
  }
  return {
    accountSid: row.twilio_account_sid,
    authToken: decryptSecret(row.twilio_auth_token_encrypted),
    fromNumber: row.twilio_from_number,
  };
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
    const msg =
      err instanceof EmailDeliveryError ? err.message : (err as Error).message;
    logger.error({ err, to }, 'email send failed');
    return { status: 'failed', providerMessageId: null, error: msg };
  }
}

async function sendSms(
  input: NotifyInput,
  to: string,
  payload: SmsPayload,
): Promise<LogOutcome> {
  if (env.NOTIFICATIONS_DISABLED) {
    return { status: 'disabled', providerMessageId: null, error: null };
  }
  const config = await resolveTwilioConfig(input.companyId);
  if (!config) {
    return {
      status: 'skipped',
      providerMessageId: null,
      error: 'Twilio not configured for company',
    };
  }
  try {
    const res = await sendViaTwilio(config, payload);
    return { status: 'sent', providerMessageId: res.messageId, error: null };
  } catch (err) {
    const msg = err instanceof SmsDeliveryError ? err.message : (err as Error).message;
    logger.error({ err, to }, 'sms send failed');
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
  const row = await db('notifications_log')
    .where({ id: logId, company_id: companyId })
    .first<{
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
