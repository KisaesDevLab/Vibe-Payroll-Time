import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { HttpError } from '../errors.js';
import { getApplianceLicenseStatus, isFreeTierClient } from '../../services/licensing/state.js';

/**
 * License-enforcement gate. Applied to mutating endpoints that should be
 * blocked for an expired license; the CLAUDE.md philosophy guarantees:
 *
 *   - internal_free / licensed: pass
 *   - trial / grace: pass (UI banners nag the admin)
 *   - expired: BLOCK mutations with a 402 Payment Required
 *   - exports and all read-only routes are never gated (not mounted
 *     behind this middleware)
 *   - internal companies bypass the gate unconditionally
 *
 * Licensing is appliance-wide — the state is read once from
 * `appliance_settings`. If a companyId is passed in and it's internal,
 * we still bypass enforcement for that request.
 *
 * When LICENSING_ENFORCED is false (the default for pre-launch
 * appliances), the middleware short-circuits every request to pass.
 */
export function enforceLicense(
  companyIdFrom: (req: Request) => number | undefined = (req) =>
    Number(req.params.companyId) || undefined,
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!env.LICENSING_ENFORCED) return next();

      // Internal companies always bypass. Free-tier client companies
      // (the first FREE_CLIENT_COMPANY_CAP non-internal companies, ranked
      // by created_at) also bypass. Everyone else checks the appliance
      // state.
      const companyId = companyIdFrom(req);
      if (Number.isFinite(companyId) && companyId) {
        const company = await db('companies')
          .where({ id: companyId })
          .first<{ is_internal: boolean; created_at: Date }>();
        if (company?.is_internal) return next();
        if (company && (await isFreeTierClient(companyId, company))) return next();
      }

      const status = await getApplianceLicenseStatus();
      if (status.state === 'expired') {
        return next(
          new HttpError(
            402,
            'license_expired',
            'The appliance license has expired and is outside the grace window. Data export and read access remain available; mutations are blocked until a renewed license is uploaded from Appliance → Settings.',
            { state: status.state, licensePortal: 'https://licensing.kisaes.com' },
          ),
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
