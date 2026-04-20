import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { HttpError } from '../errors.js';
import { computeState } from '../../services/licensing/state.js';

/**
 * License-enforcement gate. Applied to mutating endpoints that should be
 * blocked for an expired company; the CLAUDE.md philosophy guarantees:
 *
 *   - internal_free / licensed: pass
 *   - trial / grace: pass (UI banners nag the admin)
 *   - expired: BLOCK mutations with a 402 Payment Required
 *   - exports and all read-only routes are never gated (not mounted
 *     behind this middleware)
 *   - internal companies bypass the gate unconditionally
 *
 * When LICENSING_ENFORCED is false (the default for pre-launch
 * appliances), the middleware short-circuits every request to pass.
 * The /license/status endpoint still surfaces the computed state so
 * the UI banner works without enforcement being active.
 */
export function enforceLicense(
  companyIdFrom: (req: Request) => number | undefined = (req) =>
    Number(req.params.companyId) || undefined,
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!env.LICENSING_ENFORCED) return next();

      const companyId = companyIdFrom(req);
      if (!Number.isFinite(companyId) || !companyId) return next();

      const row = await db('companies').where({ id: companyId }).first<{
        is_internal: boolean;
        license_state: 'internal_free' | 'trial' | 'licensed' | 'grace' | 'expired';
        license_expires_at: Date | null;
        license_claims: Record<string, unknown> | null;
        created_at: Date;
      }>();
      if (!row) return next();

      const { state } = computeState({
        is_internal: row.is_internal,
        license_state: row.license_state,
        license_expires_at: row.license_expires_at,
        license_claims: row.license_claims as never,
        created_at: row.created_at,
      });

      if (state === 'expired') {
        return next(
          new HttpError(
            402,
            'license_expired',
            "This company's license has expired and is outside the grace window. Data export and read access remain available; mutations are blocked until a renewed license is uploaded.",
            { state, licensePortal: 'https://licensing.kisaes.com' },
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
