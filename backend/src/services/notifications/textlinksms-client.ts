/**
 * Thin HTTP client for TextLinkSMS — an alternative SMS provider to
 * Twilio. TextLinkSMS runs on end-user Android SIM cards (BYO device),
 * so the sender-number concept is the SIM ID, not a phone number.
 *
 * Spec per docs.textlinksms.com/api#sending-an-sms (verified live):
 *   POST https://textlinksms.com/api/send-sms
 *   Authorization: Bearer <api_key>
 *   Content-Type: application/json
 *   Body:     { phone_number, text, sim_card_id?, custom_id? }
 *   Success:  HTTP 200 + { ok: true, queued?: boolean }
 *   Failure:  HTTP 200 + { ok: false, message: "..." }
 *
 * Note that TextLinkSMS returns HTTP 200 for both success and failure —
 * the `ok` boolean in the body is the only authoritative outcome signal.
 * Do NOT switch to `res.ok` / status-code checks; a 200 with
 * `{ok: false}` is still a failed send.
 *
 * The response body does not include a provider-assigned message id, so
 * we mint a local `custom_id` per send and treat the acknowledgement as
 * the "id" downstream consumers log.
 */
import crypto from 'node:crypto';
import { logger } from '../../config/logger.js';
import { SmsDeliveryError, type SmsPayload, type SmsSendResult } from './twilio-client.js';

export interface TextLinkSmsConfig {
  apiKey: string;
  /** Unused by the TextLinkSMS API (the SIM card determines the
   *  sender), but kept on the config so the existing admin UI field
   *  "from number" round-trips through settings without churn. Displayed
   *  to operators as "your paired device's number" for context. */
  fromNumber: string;
  /** Numeric SIM card ID from the TextLinkSMS dashboard. Optional —
   *  if unset, TextLinkSMS picks from the account's default SIM. */
  simCardId?: number | null;
  /** Override only for a self-hosted TextLinkSMS fork or if the vendor
   *  publishes a different host. */
  baseUrl?: string | null;
}

const DEFAULT_BASE_URL = 'https://textlinksms.com';
const SEND_PATH = '/api/send-sms';

function buildRequest(
  config: TextLinkSmsConfig,
  payload: SmsPayload,
  customId: string,
): { url: string; init: RequestInit } {
  const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const body: Record<string, unknown> = {
    phone_number: payload.to,
    text: payload.body,
    custom_id: customId,
  };
  if (config.simCardId != null) body.sim_card_id = config.simCardId;
  return {
    url: `${base}${SEND_PATH}`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
  };
}

export async function sendViaTextLinkSms(
  config: TextLinkSmsConfig,
  payload: SmsPayload,
): Promise<SmsSendResult> {
  // Custom ID — lets operators correlate a send with the TextLinkSMS
  // failed-message webhook if they enable it. Short random suffix
  // keeps the identifier compact but collision-resistant.
  const customId = `vpt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const { url, init } = buildRequest(config, payload, customId);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    logger.warn({ err }, 'textlinksms: network error');
    throw new SmsDeliveryError(`TextLinkSMS network error: ${msg}`);
  }

  // TextLinkSMS still signals some failures via non-2xx (auth errors,
  // rate limiting) even though successful sends always return 200. Handle
  // both shapes.
  let data: Record<string, unknown> | null = null;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const serverMsg = typeof data?.message === 'string' ? data.message : '';
    logger.warn({ status: res.status, body: serverMsg.slice(0, 200) }, 'textlinksms: non-2xx');
    throw new SmsDeliveryError(
      `TextLinkSMS ${res.status}${serverMsg ? `: ${serverMsg.slice(0, 200)}` : ''}`,
      res.status,
    );
  }

  if (data === null) {
    logger.warn({ status: res.status }, 'textlinksms: empty response body');
    throw new SmsDeliveryError('TextLinkSMS returned an empty body');
  }

  // The whole point of this function: `ok:false` inside a 200 means
  // the send failed. Bubble the provider's reason up verbatim.
  if (data.ok !== true) {
    const reason = typeof data.message === 'string' ? data.message : 'unknown reason';
    logger.warn({ reason: reason.slice(0, 200) }, 'textlinksms: ok=false');
    throw new SmsDeliveryError(`TextLinkSMS: ${reason.slice(0, 200)}`);
  }

  // Provider doesn't return an id; use our custom_id so the log row has
  // something stable to correlate against the failed-message webhook.
  return { messageId: customId };
}
