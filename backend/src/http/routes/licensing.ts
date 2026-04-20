import { markInternalRequestSchema, uploadLicenseRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import { db } from '../../db/knex.js';
import { clearLicense, getLicenseStatus, uploadLicense } from '../../services/licensing/state.js';
import { LicenseVerifyError } from '../../services/licensing/verifier.js';
import { HttpError, Unauthorized } from '../errors.js';
import { requireAuth, requireCompanyRole, requireSuperAdmin } from '../middleware/auth.js';

export const licensingRouter: Router = Router({ mergeParams: true });

/** Any company member can read the status — banners surface it on every
 *  page. Authenticated users only; the status is not public. */
licensingRouter.get('/:companyId/license', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const result = await getLicenseStatus(Number(req.params.companyId));
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/** Company admins upload a JWT. Verifier failures surface 400s with a
 *  `code` the UI can switch on (bad_signature / no_pubkey / etc.). */
licensingRouter.post(
  '/:companyId/license',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const body = uploadLicenseRequestSchema.parse(req.body);
      try {
        const result = await uploadLicense(Number(req.params.companyId), body.jwt);
        res.status(201).json({ data: result });
      } catch (err) {
        if (err instanceof LicenseVerifyError) {
          throw new HttpError(400, `license_${err.code}`, err.message);
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

licensingRouter.delete(
  '/:companyId/license',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      await clearLicense(Number(req.params.companyId));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Flip a company's is_internal flag. SuperAdmin-only — this is a
 * material commercial decision (marking a company as "firm internal
 * staff" removes it from the licensing ledger entirely). See
 * CLAUDE.md → Licensing.
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
          license_state: body.isInternal ? 'internal_free' : 'trial',
          license_expires_at: body.isInternal ? null : db.fn.now(),
          updated_at: db.fn.now(),
        });
      const status = await getLicenseStatus(companyId);
      res.json({ data: status });
    } catch (err) {
      next(err);
    }
  },
);
