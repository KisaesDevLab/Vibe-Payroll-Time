import jwt, { type Algorithm } from 'jsonwebtoken';
import { licenseClaimsSchema, type LicenseClaims } from '@vibept/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Verify + parse a customer-uploaded license JWT against the appliance's
 * trusted public key. The key is supplied via LICENSE_PUBKEY_PEM — this
 * project intentionally does not bundle a key, so enforcement can't be
 * bypassed in prod by forgetting to set the env var: without a key, every
 * verify call throws.
 *
 * Supported algorithm is RS256 — kisaes-license-portal signs with a
 * 2048-bit RSA key.
 */

const ALGS: Algorithm[] = ['RS256'];

export class LicenseVerifyError extends Error {
  public readonly code: 'no_pubkey' | 'bad_signature' | 'expired' | 'malformed' | 'bad_claims';
  constructor(
    code: 'no_pubkey' | 'bad_signature' | 'expired' | 'malformed' | 'bad_claims',
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

export function verifyLicense(token: string): LicenseClaims {
  const pem = env.LICENSE_PUBKEY_PEM?.trim();
  if (!pem) {
    throw new LicenseVerifyError(
      'no_pubkey',
      'LICENSE_PUBKEY_PEM is not set — cannot verify license signatures.',
    );
  }

  let decoded: unknown;
  try {
    decoded = jwt.verify(token, pem, { algorithms: ALGS });
  } catch (err) {
    const name = (err as { name?: string }).name ?? 'VerifyError';
    if (name === 'TokenExpiredError') {
      // Caller needs to know this so "expired" state differs from "invalid".
      // We still try to parse the unverified claims for display.
      const unverified = jwt.decode(token, { json: true });
      const parsed = licenseClaimsSchema.safeParse(unverified);
      if (!parsed.success) {
        throw new LicenseVerifyError('malformed', 'License JWT payload is malformed');
      }
      // Re-throw as `expired` with claims attached via the message. Caller
      // that wants the claims can call decodeUnverified separately.
      throw new LicenseVerifyError('expired', 'License JWT has expired');
    }
    logger.warn({ err: name }, 'license signature verification failed');
    throw new LicenseVerifyError('bad_signature', 'License signature invalid');
  }

  const parsed = licenseClaimsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new LicenseVerifyError('bad_claims', 'License claims missing required fields');
  }
  return parsed.data;
}

/**
 * Parse claims without verifying the signature. Used for display-only
 * (e.g. showing the user what their expired license used to allow).
 * NEVER drive enforcement decisions from this.
 */
export function decodeUnverified(token: string): LicenseClaims | null {
  const decoded = jwt.decode(token, { json: true });
  const parsed = licenseClaimsSchema.safeParse(decoded);
  return parsed.success ? parsed.data : null;
}
