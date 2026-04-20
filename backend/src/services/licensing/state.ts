import type { LicenseClaims, LicenseState, LicenseStatus } from '@vibept/shared';
import { LICENSE_GRACE_DAYS, LICENSE_TRIAL_DAYS } from '@vibept/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { decodeUnverified, LicenseVerifyError, verifyLicense } from './verifier.js';

interface CompanyRow {
  id: number;
  is_internal: boolean;
  license_state: LicenseState;
  license_expires_at: Date | null;
  license_key_encrypted: string | null;
  license_claims: LicenseClaims | null;
  license_issued_at: Date | null;
  last_license_check_at: Date | null;
  created_at: Date;
}

async function loadRow(companyId: number): Promise<CompanyRow> {
  const row = await db('companies').where({ id: companyId }).first<CompanyRow>();
  if (!row) throw NotFound('Company not found');
  return row;
}

/**
 * Compute the effective state + expiry from the stored row. Pure function
 * of the row data, idempotent — safe to call on every request or to
 * invoke from the daily cron. Callers that need to persist a transition
 * call persistComputedState() below.
 */
export function computeState(row: {
  is_internal: boolean;
  license_state: LicenseState;
  license_expires_at: Date | null;
  license_claims: LicenseClaims | null;
  created_at: Date;
}): { state: LicenseState; expiresAt: Date | null; daysUntilExpiry: number | null } {
  // Internal firm-use flag is non-negotiable and ignores everything else.
  if (row.is_internal) {
    return { state: 'internal_free', expiresAt: null, daysUntilExpiry: null };
  }

  // 1. If we have valid claims + exp in the future → licensed.
  const claimsExp = row.license_claims?.exp ? new Date(row.license_claims.exp * 1000) : null;

  // Pick the authoritative expiry: claims wins over license_expires_at,
  // which wins over trial-derived expiry.
  const expiresAt =
    claimsExp ??
    row.license_expires_at ??
    new Date(row.created_at.getTime() + LICENSE_TRIAL_DAYS * 86_400_000);

  const now = Date.now();
  const days = Math.floor((expiresAt.getTime() - now) / 86_400_000);

  if (row.license_claims) {
    if (expiresAt.getTime() > now) {
      return { state: 'licensed', expiresAt, daysUntilExpiry: days };
    }
    // Expired: grace if within LICENSE_GRACE_DAYS of expiry, otherwise
    // hard-expired.
    const expiredFor = Math.floor((now - expiresAt.getTime()) / 86_400_000);
    if (expiredFor <= LICENSE_GRACE_DAYS) {
      return { state: 'grace', expiresAt, daysUntilExpiry: days };
    }
    return { state: 'expired', expiresAt, daysUntilExpiry: days };
  }

  // No claims stored → this is a trial. Same "grace after trial expiry"
  // treatment so an admin has time to paste a key.
  if (expiresAt.getTime() > now) {
    return { state: 'trial', expiresAt, daysUntilExpiry: days };
  }
  const expiredFor = Math.floor((now - expiresAt.getTime()) / 86_400_000);
  if (expiredFor <= LICENSE_GRACE_DAYS) {
    return { state: 'grace', expiresAt, daysUntilExpiry: days };
  }
  return { state: 'expired', expiresAt, daysUntilExpiry: days };
}

export async function getLicenseStatus(companyId: number): Promise<LicenseStatus> {
  const row = await loadRow(companyId);
  const { state, expiresAt, daysUntilExpiry } = computeState(row);
  return {
    state,
    expiresAt: expiresAt?.toISOString() ?? null,
    daysUntilExpiry,
    claims: row.license_claims,
    enforced: env.LICENSING_ENFORCED,
    lastCheckedAt: row.last_license_check_at?.toISOString() ?? null,
  };
}

/**
 * Upload + verify a new license JWT. Stores the encrypted raw token plus
 * parsed claims. If the JWT verifies but is already expired, we still
 * accept it so the state machine lands on `expired` (not "no license
 * uploaded"); the UI surfaces the error text.
 */
export async function uploadLicense(companyId: number, jwtToken: string): Promise<LicenseStatus> {
  let claims: LicenseClaims | null = null;
  let verifyError: LicenseVerifyError | null = null;

  try {
    claims = verifyLicense(jwtToken);
  } catch (err) {
    if (err instanceof LicenseVerifyError && err.code === 'expired') {
      // Still accept the expired token so the UI can show "what you had".
      claims = decodeUnverified(jwtToken);
      verifyError = err;
    } else {
      throw err;
    }
  }

  if (!claims) {
    throw new LicenseVerifyError('malformed', 'Could not parse license claims');
  }

  return db.transaction(async (trx) => {
    await trx('companies')
      .where({ id: companyId })
      .update({
        license_key_encrypted: encryptSecret(jwtToken),
        license_claims: JSON.stringify(claims),
        license_state: verifyError ? 'expired' : 'licensed',
        license_expires_at: new Date(claims!.exp * 1000),
        license_issued_at: new Date(claims!.iat * 1000),
        last_license_check_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    return getLicenseStatus(companyId);
  });
}

export async function clearLicense(companyId: number): Promise<void> {
  await db('companies').where({ id: companyId }).update({
    license_key_encrypted: null,
    license_claims: null,
    license_state: 'trial',
    license_expires_at: null,
    license_issued_at: null,
    last_license_check_at: null,
    updated_at: db.fn.now(),
  });
}

/**
 * Load the raw JWT for heartbeat use. Decrypts on demand; returns null
 * if the company has no license uploaded.
 */
export async function loadRawToken(companyId: number): Promise<string | null> {
  const row = await db('companies')
    .where({ id: companyId })
    .first<{ license_key_encrypted: string | null }>();
  if (!row?.license_key_encrypted) return null;
  return decryptSecret(row.license_key_encrypted);
}
