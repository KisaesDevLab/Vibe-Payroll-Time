/**
 * Thin HTTP client for EmailIt.com's transactional email API.
 *
 * The actual EmailIt API surface is documented at
 * https://emailit.com/docs — this module treats the endpoint as a
 * standard "POST JSON with a bearer key, receive a message id" shape,
 * which matches every transactional email provider on the market.
 * If the live API differs, only `buildRequest` needs adjusting.
 */
import { logger } from '../../config/logger.js';

// Hardcoded default — callers (service.ts) normally supply baseUrl from
// the DB-backed appliance-settings resolver. This constant only matters
// if a caller forgets to pass one.
const DEFAULT_EMAILIT_BASE_URL = 'https://api.emailit.com/v1';

export interface EmailItConfig {
  apiKey: string;
  baseUrl?: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string | null;
}

export interface EmailSendResult {
  messageId: string | null;
  /** HTTP status returned by EmailIt. */
  status: number;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailDeliveryError extends Error {
  public readonly status: number;
  public readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function buildRequest(
  config: EmailItConfig,
  payload: EmailPayload,
): { url: string; init: RequestInit } {
  const base = (config.baseUrl ?? DEFAULT_EMAILIT_BASE_URL).replace(/\/+$/, '');
  return {
    url: `${base}/emails`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        from: { email: config.fromEmail, name: config.fromName },
        to: [{ email: payload.to }],
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    },
  };
}

export async function sendViaEmailIt(
  config: EmailItConfig,
  payload: EmailPayload,
): Promise<EmailSendResult> {
  const { url, init } = buildRequest(config, payload);
  const res = await fetch(url, init);
  const bodyText = await res.text();
  let parsed: unknown = null;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    parsed = bodyText;
  }

  if (!res.ok) {
    logger.warn({ status: res.status, body: parsed, to: payload.to }, 'EmailIt send failed');
    throw new EmailDeliveryError(
      `EmailIt responded ${res.status}: ${truncate(bodyText, 200)}`,
      res.status,
      parsed,
    );
  }

  // EmailIt, like most providers, returns the new message id in the
  // response body. Common field names: id / message_id / data.id.
  const messageId =
    pickString(parsed, 'id') ??
    pickString(parsed, 'message_id') ??
    pickString((parsed as { data?: unknown } | null)?.data, 'id') ??
    null;

  return { messageId, status: res.status };
}

function pickString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : null;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
