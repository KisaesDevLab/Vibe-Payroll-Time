import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * AES-256-GCM symmetric encryption for per-company secrets (Twilio auth
 * token, SMTP password). The appliance-wide key comes from
 * SECRETS_ENCRYPTION_KEY, a 32-byte hex string validated at boot.
 *
 * Output format (base64url): `v1.${iv}.${tag}.${ciphertext}` — prefixed with
 * a version marker so we can migrate to a future scheme without ambiguity.
 */
const VERSION = 'v1';
const IV_BYTES = 12; // 96-bit IV recommended for GCM
const TAG_BYTES = 16;

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(env.SECRETS_ENCRYPTION_KEY, 'hex');
    if (cachedKey.length !== 32) {
      throw new Error('SECRETS_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('malformed encrypted secret');
  }

  const iv = Buffer.from(parts[1] as string, 'base64url');
  const tag = Buffer.from(parts[2] as string, 'base64url');
  const ciphertext = Buffer.from(parts[3] as string, 'base64url');

  if (iv.length !== IV_BYTES) throw new Error('invalid IV length');
  if (tag.length !== TAG_BYTES) throw new Error('invalid auth tag length');

  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** For tests: reset the cached key so a changed env var takes effect. */
export function _resetKeyCache(): void {
  cachedKey = null;
  pinFingerprintKey = null;
}

// ---------------------------------------------------------------------------
// PIN fingerprinting
// ---------------------------------------------------------------------------

/**
 * Keyed hash used to detect PIN collisions and to look up an employee by
 * PIN at the kiosk. Derived from SECRETS_ENCRYPTION_KEY via HKDF so we
 * don't introduce a second env var, and so the same key rotation policy
 * governs both.
 */
const PIN_FINGERPRINT_INFO = 'vibept:pin-fingerprint:v1';
let pinFingerprintKey: Buffer | null = null;

function getPinFingerprintKey(): Buffer {
  if (!pinFingerprintKey) {
    const derived = crypto.hkdfSync(
      'sha256',
      getKey(),
      Buffer.alloc(0),
      Buffer.from(PIN_FINGERPRINT_INFO, 'utf8'),
      32,
    );
    pinFingerprintKey = Buffer.from(derived);
  }
  return pinFingerprintKey;
}

/**
 * Compute an HMAC-SHA256 of the PIN scoped to the company. Two employees in
 * different companies with the same PIN get different fingerprints, so
 * fingerprint uniqueness is meaningful only within a `(company_id, fp)`
 * pair — which matches the partial unique index on `employees`.
 */
export function pinFingerprint(companyId: number, pin: string): string {
  const h = crypto.createHmac('sha256', getPinFingerprintKey());
  h.update(`${companyId}:${pin}`);
  return h.digest('hex');
}
