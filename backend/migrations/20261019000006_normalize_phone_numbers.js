// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Store phone numbers as E.164 ("+14145551212").
 *
 * Edits already normalized, but new employees and CSV imports kept the
 * number exactly as typed ("414-555-1212"). Twilio sends normalize at send
 * time; this brings the stored values in line so every path (TextLinkSMS,
 * phone-verification lookups, display) sees the same form.
 *
 * Same rules as services/notifications/phone-number.ts:
 *   "+…"                → "+" and the digits
 *   10 digits           → "+1" + digits (US)
 *   11 digits, leading 1 → "+" + digits
 * Anything else is left exactly as it is for an admin to fix; verification
 * status is untouched (the number itself doesn't change).
 */
function toE164(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D+/g, '');
    return digits.length >= 7 && digits.length <= 15 ? '+' + digits : null;
  }
  const digits = trimmed.replace(/\D+/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

async function normalizeColumn(knex, table) {
  const rows = await knex(table).whereNotNull('phone').select('id', 'phone');
  for (const row of rows) {
    const next = toE164(row.phone);
    if (next && next !== row.phone) {
      await knex(table).where({ id: row.id }).update({ phone: next });
    }
  }
}

exports.up = async function up(knex) {
  await normalizeColumn(knex, 'employees');
  if (await knex.schema.hasColumn('users', 'phone')) {
    await normalizeColumn(knex, 'users');
  }
};

// The original formatting isn't kept, and E.164 is valid input everywhere.
exports.down = async function down() {};
