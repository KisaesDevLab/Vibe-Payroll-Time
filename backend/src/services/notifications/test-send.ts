// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { logger } from '../../config/logger.js';
import {
  getResolvedDisplayName,
  getResolvedEmailit,
  getResolvedSmsProvider,
} from '../appliance-settings.js';
import { EmailDeliveryError, sendViaEmailIt } from './emailit-client.js';
import { normalizeToE164 } from './phone-verification.js';
import { sendViaTextLinkSms } from './textlinksms-client.js';
import { SmsDeliveryError, sendViaTwilio } from './twilio-client.js';

/**
 * SuperAdmin-facing diagnostic sends. These exist so an operator can
 * confirm their appliance-level provider credentials work without
 * triggering the full notify() pipeline (which expects a recipient
 * context that may not exist yet during setup).
 *
 * Always uses appliance-level creds — not per-company — because the
 * whole point is to verify the fallback pair is correct.
 */

export interface TestSendResult {
  ok: boolean;
  providerMessageId: string | null;
  /** Human-readable error on failure; null on success. */
  error: string | null;
  /** Provider name actually used, so the UI can render "sent via twilio". */
  provider: 'emailit' | 'twilio' | 'textlinksms' | null;
}

export async function sendTestEmail(to: string): Promise<TestSendResult> {
  if (!to.trim()) return fail('Recipient email is required', null);

  const config = await getResolvedEmailit();
  if (!config.apiKey || !config.fromEmail) {
    return fail(
      'Appliance-level EmailIt is not fully configured (need API key + from address)',
      'emailit',
    );
  }

  const appName = await getResolvedDisplayName();
  try {
    const res = await sendViaEmailIt(
      {
        apiKey: config.apiKey,
        fromEmail: config.fromEmail,
        fromName: config.fromName,
        baseUrl: config.apiBaseUrl,
      },
      {
        to,
        subject: `${appName} — test email`,
        text:
          `This is a diagnostic email from your ${appName} appliance.\n` +
          'Receiving it confirms the configured EmailIt credentials work.',
        html:
          `<p>This is a diagnostic email from your <b>${escapeHtml(appName)}</b> appliance.</p>` +
          '<p>Receiving it confirms the configured EmailIt credentials work.</p>',
      },
    );
    return {
      ok: true,
      providerMessageId: res.messageId,
      error: null,
      provider: 'emailit',
    };
  } catch (err) {
    const msg = err instanceof EmailDeliveryError ? err.message : (err as Error).message;
    logger.warn({ err, to }, 'test email send failed');
    return fail(msg, 'emailit');
  }
}

export async function sendTestSms(to: string): Promise<TestSendResult> {
  if (!to.trim()) return fail('Recipient phone number is required', null);

  // Normalize to E.164 up-front so "5551234567" routes the same as
  // "+15551234567" — avoids the silent-non-delivery pattern where
  // TextLinkSMS accepts the API call but the paired Android can't
  // dial a number without a country code.
  let normalized: string;
  try {
    normalized = normalizeToE164(to);
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Invalid phone', null);
  }

  const resolved = await getResolvedSmsProvider();
  if (!resolved.provider) {
    return fail('No appliance-level SMS provider selected', null);
  }

  const appName = await getResolvedDisplayName();
  const body = `${appName} — test SMS. Receiving this confirms your appliance SMS credentials work.`;

  try {
    if (resolved.provider === 'twilio') {
      if (!resolved.twilio) {
        return fail('Twilio selected but credentials are incomplete', 'twilio');
      }
      const res = await sendViaTwilio(resolved.twilio, { to: normalized, body });
      return {
        ok: true,
        providerMessageId: res.messageId,
        error: null,
        provider: 'twilio',
      };
    }
    // textlinksms
    if (!resolved.textlinksms) {
      return fail('TextLinkSMS selected but credentials are incomplete', 'textlinksms');
    }
    const res = await sendViaTextLinkSms(resolved.textlinksms, { to: normalized, body });
    return {
      ok: true,
      providerMessageId: res.messageId,
      error: null,
      provider: 'textlinksms',
    };
  } catch (err) {
    const msg = err instanceof SmsDeliveryError ? err.message : (err as Error).message;
    logger.warn({ err, to, provider: resolved.provider }, 'test sms send failed');
    return fail(msg, resolved.provider);
  }
}

function fail(error: string, provider: TestSendResult['provider']): TestSendResult {
  return { ok: false, providerMessageId: null, error, provider };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
