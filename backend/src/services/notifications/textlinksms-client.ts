/**
 * Thin HTTP client for TextLinkSMS — an alternative SMS provider to
 * Twilio. TextLinkSMS offers per-message pricing that's attractive for
 * small-volume deployments, and its REST API is simpler (no SDK).
 *
 * The treatment here follows the EmailIt pattern: treat the endpoint
 * as a standard "POST JSON with a bearer key, receive an id" shape.
 * If the live API differs in minor details, only `buildRequest` needs
 * adjusting.
 */
import { logger } from '../../config/logger.js';
import { SmsDeliveryError, type SmsPayload, type SmsSendResult } from './twilio-client.js';

export interface TextLinkSmsConfig {
  apiKey: string;
  fromNumber: string;
  /** Override only if TextLinkSMS publishes a different endpoint. */
  baseUrl?: string | null;
}

const DEFAULT_BASE_URL = 'https://app.textlinksms.com/api/v1';

function buildRequest(
  config: TextLinkSmsConfig,
  payload: SmsPayload,
): { url: string; init: RequestInit } {
  const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  return {
    url: `${base}/sms/send`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        from: config.fromNumber,
        to: payload.to,
        message: payload.body,
      }),
    },
  };
}

export async function sendViaTextLinkSms(
  config: TextLinkSmsConfig,
  payload: SmsPayload,
): Promise<SmsSendResult> {
  const { url, init } = buildRequest(config, payload);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error';
    logger.warn({ err }, 'textlinksms: network error');
    throw new SmsDeliveryError(`TextLinkSMS network error: ${msg}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    logger.warn({ status: res.status, body: text.slice(0, 200) }, 'textlinksms: send failed');
    throw new SmsDeliveryError(`TextLinkSMS ${res.status}: ${text.slice(0, 200)}`, res.status);
  }

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const id =
    (data?.id as string | undefined) ??
    (data?.message_id as string | undefined) ??
    (data?.messageId as string | undefined) ??
    '';
  return { messageId: id };
}
