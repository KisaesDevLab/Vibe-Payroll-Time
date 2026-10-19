// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { BadRequest } from '../../http/errors.js';

/**
 * Coerce operator-entered phone strings into strict E.164 ("+15551234567").
 * This is what both Twilio and TextLinkSMS actually want — without the
 * leading `+` and country code, the Android SIM paired to a
 * TextLinkSMS account silently fails to route the message, which is
 * exactly the "I sent a verify but never got the SMS" symptom.
 *
 * Rules:
 *   - already starts with `+`: keep the `+`, drop everything
 *     non-digit after it.
 *   - 10 bare digits: prepend `+1` (US default — product target).
 *   - 11 digits starting with `1`: prepend `+`.
 *   - anything else: reject with a clear error so the UI can say so.
 *
 * If we ever target non-US customers as a primary audience, expose an
 * appliance-level default country. Until then this assumption matches
 * the rest of the product (pay periods, FLSA OT, etc.).
 */
export function normalizeToE164(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D+/g, '');
    if (digits.length < 7 || digits.length > 15) {
      throw BadRequest(`Phone must be 7–15 digits after the country code (got ${digits.length}).`);
    }
    return '+' + digits;
  }
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  throw BadRequest(
    'Phone number must be 10 digits for US numbers, or include a country code starting with +.',
  );
}
