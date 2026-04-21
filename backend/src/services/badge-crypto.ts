// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import crypto from 'node:crypto';
import { BADGE_TOKEN_VERSION } from '@vibept/shared';
import { env } from '../config/env.js';

/**
 * QR badge token: HMAC-signed, compact, URL-safe.
 *
 *   `vpt1.{companyId}.{employeeId}.{badgeVersion}.{nonceB64}.{hmacB64}`
 *
 *     - The separator is a dot so a QR decoder that munges whitespace doesn't
 *       break anything.
 *     - `companyId` is included so the server rejects cross-company scans
 *       without a database lookup (defense in depth — the primary check is
 *       still the `(company_id, badge_token_hash)` row).
 *     - `badgeVersion` invalidates prior physical badges on reissue.
 *     - `nonce` prevents two identical-version badges from hashing the same.
 *       The hash stored on `employees.badge_token_hash` is sha256 of the full
 *       payload string, not a secret — its job is to find the employee given
 *       a scanned payload.
 *     - `hmac` is HMAC-SHA256 of everything before it, truncated to 16
 *       bytes / 128 bits, which is plenty for a non-cryptographic uniqueness
 *       claim on a short-lived identifier.
 *
 * We derive the HMAC key from BADGE_SIGNING_SECRET when set; otherwise
 * from SECRETS_ENCRYPTION_KEY via HKDF. This matches the PIN fingerprint
 * pattern — one env var controls rotation; dev doesn't need a new secret.
 */

const NONCE_BYTES = 8;
const HMAC_TRUNCATE_BYTES = 16;
const HKDF_INFO = 'vibept:badge-signing:v1';

// Exact lengths of base64url-no-padding encodings of NONCE_BYTES and
// HMAC_TRUNCATE_BYTES. Pinning these lets us reject payloads where an
// attacker appended whitespace or other characters that Node's
// `Buffer.from(str, 'base64url')` parser silently ignores.
const NONCE_B64_LEN = 11; // 8 bytes → 11 base64url chars (no padding)
const MAC_B64_LEN = 22; // 16 bytes → 22 base64url chars (no padding)

// Base64url alphabet: A-Z a-z 0-9 - _
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
// Positive integers without leading zeros (except "0" itself which we
// reject separately below for non-identifier fields).
const POSITIVE_INT_RE = /^[1-9][0-9]*$/;

let cachedKey: Buffer | null = null;

function getSigningKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (env.BADGE_SIGNING_SECRET) {
    // Accept either raw utf8 (32+ chars) or hex-encoded 32 bytes.
    const secret = env.BADGE_SIGNING_SECRET;
    const looksHex = /^[0-9a-fA-F]{64}$/.test(secret);
    cachedKey = looksHex ? Buffer.from(secret, 'hex') : Buffer.from(secret, 'utf8');
    return cachedKey;
  }
  // Derive from the appliance encryption key so dev/test work out of the box.
  const ikm = Buffer.from(env.SECRETS_ENCRYPTION_KEY, 'hex');
  cachedKey = Buffer.from(
    crypto.hkdfSync('sha256', ikm, Buffer.alloc(0), Buffer.from(HKDF_INFO, 'utf8'), 32),
  );
  return cachedKey;
}

/** Test hook — lets a test flip BADGE_SIGNING_SECRET and re-derive. */
export function _resetBadgeKeyCache(): void {
  cachedKey = null;
}

export interface BadgeTokenFields {
  companyId: number;
  employeeId: number;
  badgeVersion: number;
}

export interface GeneratedBadgeToken {
  payload: string;
  /** sha256 of the full payload — stored on the employee row. */
  hash: string;
}

/** Generate a fresh, signed payload. Call exactly once per issue —
 *  the payload is not derivable after this since the nonce is random. */
export function generateBadgeToken(fields: BadgeTokenFields): GeneratedBadgeToken {
  const nonce = crypto.randomBytes(NONCE_BYTES).toString('base64url');
  const preHmac = [
    BADGE_TOKEN_VERSION,
    String(fields.companyId),
    String(fields.employeeId),
    String(fields.badgeVersion),
    nonce,
  ].join('.');
  const mac = crypto
    .createHmac('sha256', getSigningKey())
    .update(preHmac)
    .digest()
    .subarray(0, HMAC_TRUNCATE_BYTES)
    .toString('base64url');
  const payload = `${preHmac}.${mac}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return { payload, hash };
}

export interface ParsedBadgeToken {
  companyId: number;
  employeeId: number;
  badgeVersion: number;
  /** sha256 of the full payload — used to look up the employee row. */
  hash: string;
}

/**
 * Parse + HMAC-verify a scanned payload. Returns null on any failure so
 * the caller can decide how to log; never throws for malformed input.
 * HMAC is compared in constant time.
 */
export function verifyBadgeToken(payload: string): ParsedBadgeToken | null {
  if (typeof payload !== 'string') return null;
  // Cap input length so a hostile client can't stream megabytes through
  // our parser. The legitimate payload is ~50 bytes.
  if (payload.length > 256) return null;
  const parts = payload.split('.');
  if (parts.length !== 6) return null;
  const [version, companyStr, employeeStr, versionStr, nonce, macB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== BADGE_TOKEN_VERSION) return null;

  // Strict lexical validation. Rejecting anything that doesn't match the
  // exact format closes the whitespace-appended-to-base64 evasion path —
  // Node's base64url decoder silently ignores non-alphabet characters,
  // so we cannot rely on Buffer.from() alone to enforce a canonical form.
  if (!POSITIVE_INT_RE.test(companyStr)) return null;
  if (!POSITIVE_INT_RE.test(employeeStr)) return null;
  if (!POSITIVE_INT_RE.test(versionStr)) return null;
  if (nonce.length !== NONCE_B64_LEN || !B64URL_RE.test(nonce)) return null;
  if (macB64.length !== MAC_B64_LEN || !B64URL_RE.test(macB64)) return null;

  const companyId = Number(companyStr);
  const employeeId = Number(employeeStr);
  const badgeVersion = Number(versionStr);
  // Even with POSITIVE_INT_RE, astronomically large numbers could squeak by;
  // reject anything that lost precision in the Number() cast.
  if (!Number.isSafeInteger(companyId)) return null;
  if (!Number.isSafeInteger(employeeId)) return null;
  if (!Number.isSafeInteger(badgeVersion)) return null;

  const preHmac = [version, companyStr, employeeStr, versionStr, nonce].join('.');
  const expected = crypto
    .createHmac('sha256', getSigningKey())
    .update(preHmac)
    .digest()
    .subarray(0, HMAC_TRUNCATE_BYTES);

  const actual = Buffer.from(macB64, 'base64url');
  if (actual.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(actual, expected)) return null;

  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return { companyId, employeeId, badgeVersion, hash };
}
