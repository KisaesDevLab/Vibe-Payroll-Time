// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { LicenseClaims, LicenseState, LicenseStatus } from '@vibept/shared';
import { FREE_CLIENT_COMPANY_CAP, LICENSE_GRACE_DAYS, LICENSE_TRIAL_DAYS } from '@vibept/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import { decodeUnverified, LicenseVerifyError, verifyLicense } from './verifier.js';

/**
 * Appliance-wide licensing.
 *
 * The commercial model actually in production is: one CPA firm buys one
 * appliance, the license covers every company on it. A license JWT lives
 * once on the `appliance_settings` singleton and drives the state for
 * every non-internal company on the box.
 *
 * `computeState` stays the pure shape it's always been — it just reads
 * the appliance's `created_at` as the trial-start anchor now, instead
 * of a company's.
 */

const APPLIANCE_ROW_ID = 1;

interface ApplianceLicenseRow {
  license_state: LicenseState | null;
  license_expires_at: Date | null;
  license_key_encrypted: string | null;
  license_claims: LicenseClaims | null;
  license_issued_at: Date | null;
  last_license_check_at: Date | null;
  created_at: Date;
}

async function loadApplianceRow(): Promise<ApplianceLicenseRow> {
  const row = await db('appliance_settings')
    .where({ id: APPLIANCE_ROW_ID })
    .first<ApplianceLicenseRow>();
  if (!row) throw NotFound('appliance_settings singleton missing');
  return row;
}

/**
 * Pure state computation. Same semantics as before — kept a pure
 * function of whatever row-shape you pass in so the appliance path and
 * any legacy per-company read share the derivation.
 *
 * Inputs:
 *   - `isInternal` pins the state to `internal_free` regardless of
 *     everything else. Only the company-scoped resolver passes true;
 *     the appliance row is never internal.
 *   - `license_claims` wins over `license_expires_at` wins over
 *     `created_at + trial window`.
 */
export function computeState(row: {
  isInternal?: boolean;
  license_expires_at: Date | null;
  license_claims: LicenseClaims | null;
  created_at: Date;
}): { state: LicenseState; expiresAt: Date | null; daysUntilExpiry: number | null } {
  if (row.isInternal) {
    return { state: 'internal_free', expiresAt: null, daysUntilExpiry: null };
  }

  const claimsExp = row.license_claims?.exp ? new Date(row.license_claims.exp * 1000) : null;

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
    const expiredFor = Math.floor((now - expiresAt.getTime()) / 86_400_000);
    if (expiredFor <= LICENSE_GRACE_DAYS) {
      return { state: 'grace', expiresAt, daysUntilExpiry: days };
    }
    return { state: 'expired', expiresAt, daysUntilExpiry: days };
  }

  // Trial path — no claims uploaded yet.
  if (expiresAt.getTime() > now) {
    return { state: 'trial', expiresAt, daysUntilExpiry: days };
  }
  const expiredFor = Math.floor((now - expiresAt.getTime()) / 86_400_000);
  if (expiredFor <= LICENSE_GRACE_DAYS) {
    return { state: 'grace', expiresAt, daysUntilExpiry: days };
  }
  return { state: 'expired', expiresAt, daysUntilExpiry: days };
}

/**
 * Canonical appliance-wide license status. This is what the SuperAdmin
 * UI reads and what the middleware enforces against.
 */
export async function getApplianceLicenseStatus(): Promise<LicenseStatus> {
  const row = await loadApplianceRow();
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
 * Company-scoped resolver. Returns `internal_free` for:
 *   - Any internal firm company (always free, unconditionally)
 *   - The first FREE_CLIENT_COMPANY_CAP non-internal companies on the
 *     appliance, ranked by created_at ascending (a firm can include
 *     up to 5 client companies in the free tier)
 *
 * Everything else mirrors the appliance-wide license state.
 */
export async function getLicenseStatusForCompany(companyId: number): Promise<LicenseStatus> {
  const company = await db('companies').where({ id: companyId }).first<{
    is_internal: boolean;
    created_at: Date;
  }>();
  if (!company) throw NotFound('Company not found');

  if (company.is_internal || (await isFreeTierClient(companyId, company))) {
    const row = await loadApplianceRow();
    return {
      state: 'internal_free',
      expiresAt: null,
      daysUntilExpiry: null,
      claims: row.license_claims,
      enforced: env.LICENSING_ENFORCED,
      lastCheckedAt: row.last_license_check_at?.toISOString() ?? null,
    };
  }

  return getApplianceLicenseStatus();
}

/**
 * True iff `company` is one of the first FREE_CLIENT_COMPANY_CAP
 * non-internal companies on the appliance (ranked by created_at asc,
 * ties broken by id asc). Exposed so the license middleware and the
 * heartbeat share the same semantics.
 */
export async function isFreeTierClient(
  companyId: number,
  company: { is_internal: boolean; created_at: Date },
): Promise<boolean> {
  if (company.is_internal) return false;

  const earlierCount = await db('companies')
    .whereNot('is_internal', true)
    .whereNull('disabled_at') // retired clients shouldn't occupy a free slot
    .where(function () {
      this.where('created_at', '<', company.created_at).orWhere(function () {
        this.where('created_at', '=', company.created_at).andWhere('id', '<', companyId);
      });
    })
    .count<{ count: string }>({ count: '*' })
    .first();

  const rank = 1 + Number(earlierCount?.count ?? 0);
  return rank <= FREE_CLIENT_COMPANY_CAP;
}

/**
 * Upload + verify a new license JWT. Replaces any existing one.
 * Appliance-wide: no companyId. SuperAdmin only at the route layer.
 */
export async function uploadLicense(jwtToken: string): Promise<LicenseStatus> {
  let claims: LicenseClaims | null = null;
  let verifyError: LicenseVerifyError | null = null;

  try {
    claims = verifyLicense(jwtToken);
  } catch (err) {
    if (err instanceof LicenseVerifyError && err.code === 'expired') {
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
    await trx('appliance_settings')
      .where({ id: APPLIANCE_ROW_ID })
      .update({
        license_key_encrypted: encryptSecret(jwtToken),
        license_claims: JSON.stringify(claims),
        license_state: verifyError ? 'expired' : 'licensed',
        license_expires_at: new Date(claims!.exp * 1000),
        license_issued_at: new Date(claims!.iat * 1000),
        last_license_check_at: trx.fn.now(),
        updated_at: trx.fn.now(),
      });

    return getApplianceLicenseStatus();
  });
}

export async function clearLicense(): Promise<void> {
  await db('appliance_settings').where({ id: APPLIANCE_ROW_ID }).update({
    license_key_encrypted: null,
    license_claims: null,
    license_state: null,
    license_expires_at: null,
    license_issued_at: null,
    last_license_check_at: null,
    updated_at: db.fn.now(),
  });
}

/**
 * Load the raw JWT for heartbeat use. Decrypts on demand; returns null
 * if no license is uploaded.
 */
export async function loadRawToken(): Promise<string | null> {
  const row = await db('appliance_settings')
    .where({ id: APPLIANCE_ROW_ID })
    .first<{ license_key_encrypted: string | null }>();
  if (!row?.license_key_encrypted) return null;
  return decryptSecret(row.license_key_encrypted);
}
