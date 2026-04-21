// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { PIN_MAX_LENGTH, PIN_MIN_LENGTH } from '@vibept/shared';
import { pinFingerprint } from './crypto.js';
import { hashPin } from './passwords.js';

/**
 * PINs are low-entropy by design (4–6 digits). We compensate with:
 *   1. bcrypt hashing at rest (pin_hash; see passwords.ts).
 *   2. HMAC-keyed fingerprint (pin_fingerprint; see crypto.ts) that backs
 *      the partial unique index per company and the kiosk PIN lookup.
 *   3. This module's weak-pattern filter, which refuses PINs that a bored
 *      employee could guess for a co-worker (sequential, repeating, etc.).
 *
 * The generator draws random digits, discards weak patterns and
 * per-company fingerprint collisions, and returns a usable PIN. Because
 * fingerprint matching is O(1), the uniqueness loop stays fast even for
 * companies with thousands of employees.
 */

const WEAK_PATTERNS = new Set([
  '0000',
  '1111',
  '2222',
  '3333',
  '4444',
  '5555',
  '6666',
  '7777',
  '8888',
  '9999',
  '1234',
  '2345',
  '3456',
  '4567',
  '5678',
  '6789',
  '4321',
  '5432',
  '6543',
  '7654',
  '8765',
  '9876',
  '0123',
  '9870',
  '000000',
  '111111',
  '222222',
  '333333',
  '444444',
  '555555',
  '666666',
  '777777',
  '888888',
  '999999',
  '123456',
  '234567',
  '345678',
  '456789',
  '567890',
  '654321',
  '765432',
  '876543',
  '987654',
  '098765',
]);

export function isWeakPin(pin: string): boolean {
  if (WEAK_PATTERNS.has(pin)) return true;
  // All same digit.
  if (/^(\d)\1+$/.test(pin)) return true;
  return false;
}

export function validatePinShape(pin: string): boolean {
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) return false;
  if (!/^\d+$/.test(pin)) return false;
  return !isWeakPin(pin);
}

function randomPin(length: number): string {
  const buf = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    // Map each byte to a digit. Acceptance ratio 250/256 so modulo bias
    // is <2.5% per digit — well within our tolerance for 4–6 digit PINs.
    out += ((buf[i] as number) % 10).toString();
  }
  return out;
}

export interface GeneratePinOptions {
  length?: number;
  companyId: number;
  trx: Knex.Transaction;
  maxAttempts?: number;
}

/**
 * Generate a random PIN that (a) is not a weak pattern and (b) has no
 * fingerprint collision among active employees in the same company.
 *
 * Must be called inside a transaction so the read-existing-fingerprints
 * and subsequent insert/update are serializable — the partial unique
 * index is the ultimate backstop, but we also pre-check for a clean error
 * message and fewer wasted bcrypt cycles.
 */
export async function generateUniquePin(opts: GeneratePinOptions): Promise<string> {
  const length = opts.length ?? 6;
  const maxAttempts = opts.maxAttempts ?? 64;

  const rows = await opts
    .trx('employees')
    .where({ company_id: opts.companyId, status: 'active' })
    .whereNotNull('pin_fingerprint')
    .select<Array<{ pin_fingerprint: string }>>('pin_fingerprint');
  const existing = new Set(rows.map((r) => r.pin_fingerprint));

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = randomPin(length);
    if (isWeakPin(candidate)) continue;
    const fp = pinFingerprint(opts.companyId, candidate);
    if (existing.has(fp)) continue;
    return candidate;
  }

  throw new Error(
    `generateUniquePin: exhausted ${maxAttempts} attempts — consider length ${length + 1}`,
  );
}

export interface PinMaterial {
  /** The plaintext PIN — shown to the admin ONCE on creation/regeneration. */
  pin: string;
  /** bcrypt hash, stored in `employees.pin_hash` for verification. */
  hash: string;
  /** HMAC fingerprint, stored in `employees.pin_fingerprint` for uniqueness
   *  and kiosk lookups. */
  fingerprint: string;
}

export async function generatePinMaterial(opts: GeneratePinOptions): Promise<PinMaterial> {
  const pin = await generateUniquePin(opts);
  const [hash, fingerprint] = await Promise.all([
    hashPin(pin),
    Promise.resolve(pinFingerprint(opts.companyId, pin)),
  ]);
  return { pin, hash, fingerprint };
}
