// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { markInternalRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import { db } from '../../db/knex.js';
import { getLicenseStatusForCompany } from '../../services/licensing/state.js';
import { HttpError, Unauthorized } from '../errors.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export const licensingRouter: Router = Router({ mergeParams: true });

/**
 * Licensing is appliance-wide (see services/licensing/state.ts). This
 * per-company GET is kept for backward compat — the banner on each
 * company page just needs the state, and for internal companies that
 * state is always `internal_free` regardless of the appliance license.
 */
licensingRouter.get('/:companyId/license', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const result = await getLicenseStatusForCompany(Number(req.params.companyId));
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * Per-company license upload / clear is gone. The SuperAdmin uploads
 * one license to /api/v1/admin/license — it applies to every non-
 * internal company on the appliance. Return 410 Gone so any client
 * still hitting these paths gets a clear signal.
 */
const gonePayload = {
  upgrade: '/api/v1/admin/license',
  message:
    'Licensing is appliance-wide now. Upload a license at /api/v1/admin/license (or Appliance → Settings in the UI).',
};

licensingRouter.post('/:companyId/license', requireAuth, async (_req, _res, next) => {
  next(new HttpError(410, 'moved_to_appliance', gonePayload.message, gonePayload));
});
licensingRouter.delete('/:companyId/license', requireAuth, async (_req, _res, next) => {
  next(new HttpError(410, 'moved_to_appliance', gonePayload.message, gonePayload));
});

/**
 * Flip a company's is_internal flag. SuperAdmin-only — material commercial
 * decision. Internal companies bypass licensing enforcement unconditionally,
 * so toggling this is meaningful even under appliance-wide licensing.
 */
licensingRouter.patch(
  '/:companyId/license/internal-flag',
  requireAuth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      const body = markInternalRequestSchema.parse(req.body);
      const companyId = Number(req.params.companyId);
      await db('companies')
        .where({ id: companyId })
        .update({
          is_internal: body.isInternal,
          // Legacy per-company column — kept in sync for any code that still
          // reads it, but licensing decisions all come from appliance state.
          license_state: body.isInternal ? 'internal_free' : 'trial',
          updated_at: db.fn.now(),
        });
      const status = await getLicenseStatusForCompany(companyId);
      res.json({ data: status });
    } catch (err) {
      next(err);
    }
  },
);
