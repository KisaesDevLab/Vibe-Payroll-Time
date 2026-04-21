// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import bcrypt from 'bcrypt';

/** Cost factor for user passwords. 2^12 ≈ 250 ms on a NucBox M6 — safely
 *  above brute-force thresholds while still interactive. */
const PASSWORD_COST = 12;

/** Cost factor for kiosk PINs. PINs are low-entropy by design (4–6 digits),
 *  so lowering the cost would not meaningfully change attacker economics.
 *  Cost 10 keeps kiosk PIN verification under 50 ms for responsive keypad
 *  UX. */
const PIN_COST = 10;

export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, PASSWORD_COST);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, PIN_COST);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
