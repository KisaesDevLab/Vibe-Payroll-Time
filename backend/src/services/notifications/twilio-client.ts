// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import twilio from 'twilio';
import { normalizeToE164 } from './phone-number.js';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export interface SmsPayload {
  to: string;
  body: string;
}

export interface SmsSendResult {
  messageId: string;
}

export class SmsDeliveryError extends Error {
  public readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    if (status !== undefined) this.status = status;
  }
}

/** A Twilio Messaging Service SID ("MG" + 32 hex) may stand in for a
 *  from number — Twilio then picks the sender from the service's pool. */
const MESSAGING_SERVICE_SID = /^MG[0-9a-f]{32}$/i;

/**
 * Normalize an operator-entered sender: a Messaging Service SID as-is,
 * otherwise E.164. Throws (400) on something Twilio could never accept.
 */
export function normalizeTwilioSender(raw: string): string {
  const v = raw.trim();
  return MESSAGING_SERVICE_SID.test(v) ? v : normalizeToE164(v);
}

/** Save-time cleanup: trim pasted credentials; blank means cleared. */
export function cleanTwilioCredential(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

/** Save-time cleanup of the sender: blank → cleared, otherwise a
 *  Messaging Service SID or E.164 — a 400 on anything else, so a bad
 *  From number is caught when it's typed, not on the first send. */
export function cleanTwilioSender(raw: string | null | undefined): string | null {
  const v = raw?.trim();
  return v ? normalizeTwilioSender(v) : null;
}

/** Plain-language hints for the Twilio error codes people actually hit,
 *  so the notifications log says what to do, not just what failed. */
const TWILIO_HINTS: Record<number, string> = {
  20003: 'the Account SID or Auth Token is wrong',
  21211: 'the recipient number is not a valid phone number',
  21212: 'the From number is not valid — use your Twilio number in +1… format',
  21408: 'SMS to this country is not enabled in your Twilio geo permissions',
  21606: 'the From number is not an SMS-capable number on this Twilio account',
  21608: 'trial accounts can only text numbers verified in the Twilio console',
  21610: 'the recipient replied STOP; they must text START to receive messages',
  21614: 'the recipient number is not a mobile number',
  30003: 'the recipient phone is off or unreachable',
  30004: 'the recipient has blocked messages from this number',
  30005: 'the recipient number does not exist or is not in service',
  30006: 'the recipient is a landline or cannot receive texts',
  30007:
    'the carrier filtered the message as spam — register the number (A2P 10DLC) or change the wording',
  30008: 'the carrier failed to deliver for an unknown reason; try again',
  30032: 'toll-free numbers must be verified with Twilio before they can text',
  30034: 'US carriers block unregistered senders — register the number for A2P 10DLC',
};

export function twilioHint(code: number | null | undefined): string | null {
  return code ? (TWILIO_HINTS[code] ?? null) : null;
}

export interface TwilioDelivery {
  /** Twilio's message status: queued, sending, sent, delivered,
   *  undelivered, failed (… or still in flight when we stopped waiting). */
  status: string;
  errorCode: number | null;
  /** "Twilio 30034: … (hint)" when the carrier rejected it. */
  detail: string | null;
  /** True once Twilio has a final answer. */
  final: boolean;
}

const FINAL_STATUSES = new Set(['delivered', 'undelivered', 'failed', 'read']);

/**
 * Twilio accepting a message only means it was queued. Carrier rejections
 * (unregistered A2P 10DLC numbers, spam filtering, trial-account limits)
 * arrive seconds later, so a diagnostic send polls the message until it
 * settles. Used by the test-SMS buttons, never on the regular send path.
 */
export async function waitForTwilioDelivery(
  config: TwilioConfig,
  messageSid: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<TwilioDelivery> {
  const client = twilio(config.accountSid.trim(), config.authToken.trim());
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  const interval = opts.intervalMs ?? 1_500;
  let last: TwilioDelivery = { status: 'queued', errorCode: null, detail: null, final: false };
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      // Bound each lookup by the time left, so a slow Twilio API can't
      // hold the test send past its deadline.
      const remaining = Math.max(0, deadline - Date.now());
      const m = await Promise.race([
        client.messages(messageSid).fetch(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('lookup timed out')), remaining),
        ),
      ]);
      const code = m.errorCode ?? null;
      const hint = twilioHint(code);
      last = {
        status: m.status,
        errorCode: code,
        detail: code
          ? `Twilio ${code}${m.errorMessage ? `: ${m.errorMessage}` : ''}${hint ? ` (${hint})` : ''}`
          : null,
        final: FINAL_STATUSES.has(m.status),
      };
      if (last.final) return last;
    } catch {
      // A transient lookup failure isn't the send failing; keep waiting.
    }
  }
  return last;
}

/**
 * Per-send client — instantiate with decrypted credentials, send, let
 * the client drop out of scope. Twilio SDK handles connection reuse
 * internally when the same config is seen repeatedly; for our
 * infrequent send volume this is a non-issue.
 *
 * Credentials and numbers are cleaned up here, at the one place every
 * send passes through: settings saved before the save-time normalization
 * (or pasted with a trailing space/newline) would otherwise fail every
 * send with 20003 / 21212.
 */
export async function sendViaTwilio(
  config: TwilioConfig,
  payload: SmsPayload,
): Promise<SmsSendResult> {
  let sender: string;
  let to: string;
  try {
    sender = normalizeTwilioSender(config.fromNumber);
    to = normalizeToE164(payload.to);
  } catch (err) {
    throw new SmsDeliveryError(
      `Twilio not attempted: ${err instanceof Error ? err.message : 'invalid number'}`,
      400,
    );
  }
  const client = twilio(config.accountSid.trim(), config.authToken.trim());
  try {
    const message = await client.messages.create({
      ...(MESSAGING_SERVICE_SID.test(sender) ? { messagingServiceSid: sender } : { from: sender }),
      to,
      body: payload.body,
    });
    return { messageId: message.sid };
  } catch (err) {
    const e = err as { status?: number; code?: number; message?: string };
    const hint = twilioHint(e.code);
    const msg = [
      e.code ? `Twilio ${e.code}` : 'Twilio',
      e.message ?? 'send failed',
      hint ? `(${hint})` : null,
    ]
      .filter(Boolean)
      .join(': ')
      .replace(/: \(/, ' (');
    throw new SmsDeliveryError(msg, e.status);
  }
}
