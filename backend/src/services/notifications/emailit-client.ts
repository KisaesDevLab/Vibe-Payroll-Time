// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Thin HTTP client for EmailIt.com's transactional email API.
 *
 * Spec per https://emailit.com/docs/api-reference/emails/send/ (verified live):
 *   POST https://api.emailit.com/v2/emails
 *   Authorization: Bearer <api_key>
 *   Content-Type: application/json
 *   Body:     { from: "Name <email>" | "email",
 *               to: string | string[],
 *               subject, html, text, reply_to? }
 *   Success:  HTTP 200/201 + { id, message_id, ... }
 *   Failure:  HTTP 4xx/5xx + { error, validation_errors? | details? }
 *
 * Notes that earlier versions of this module got wrong (fixed below):
 *   - URL was /v1/ — the live API is /v2/.
 *   - `from` used a {email, name} object — the API wants a string,
 *     either bare "email" or RFC 5322 "Name <email>".
 *   - `to` used [{email}] — the API wants a string or array of strings.
 */
import { logger } from '../../config/logger.js';

// Hardcoded default — callers (service.ts) normally supply baseUrl from
// the DB-backed appliance-settings resolver. This constant only matters
// if a caller forgets to pass one.
const DEFAULT_EMAILIT_BASE_URL = 'https://api.emailit.com/v2';

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
  // Compose the RFC 5322-style From header value the API expects. When a
  // display name is present we emit "Name <email>"; otherwise just the
  // bare email. Quoting the name defensively because a bare comma or
  // angle-bracket in the name would malform the header and the API
  // would reject the send.
  const fromHeader = config.fromName
    ? `"${config.fromName.replace(/"/g, '\\"')}" <${config.fromEmail}>`
    : config.fromEmail;
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
        from: fromHeader,
        to: payload.to,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
      }),
    },
  };
}

/** Hard ceiling on a single send. Above this we stop waiting and treat
 *  the send as failed — better a logged failure the operator can retry
 *  than a missed-punch cron tick that hangs forever on a stuck TLS
 *  handshake to the EmailIt edge. 15 s comfortably covers their p99
 *  while still letting the every-5-minutes cron fire on schedule. */
const EMAILIT_TIMEOUT_MS = 15_000;

export async function sendViaEmailIt(
  config: EmailItConfig,
  payload: EmailPayload,
): Promise<EmailSendResult> {
  const { url, init } = buildRequest(config, payload);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(EMAILIT_TIMEOUT_MS) });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
    const msg = err instanceof Error ? err.message : 'network error';
    logger.warn({ err, isTimeout }, 'EmailIt fetch failed');
    throw new EmailDeliveryError(
      isTimeout
        ? `EmailIt timed out after ${EMAILIT_TIMEOUT_MS}ms`
        : `EmailIt network error: ${msg}`,
      0,
      null,
    );
  }
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
