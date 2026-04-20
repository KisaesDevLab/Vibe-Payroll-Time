import {
  createCompanyRequestSchema,
  createEmployeeRequestSchema,
  createJobRequestSchema,
  createKioskPairingCodeRequestSchema,
  csvImportRequestSchema,
  inviteMembershipRequestSchema,
  renameKioskDeviceRequestSchema,
  updateCompanyRequestSchema,
  updateCompanySettingsRequestSchema,
  updateEmployeeRequestSchema,
  updateJobRequestSchema,
} from '@vibept/shared';
import { type Request, type Response, type NextFunction, Router } from 'express';
import { z } from 'zod';
import {
  createCompany,
  listCompanies,
  requireCompany,
  updateCompany,
  userCanAccessCompany,
} from '../../services/companies.js';
import { getCompanySettings, updateCompanySettings } from '../../services/company-settings.js';
import {
  createEmployee,
  getEmployee,
  importEmployeesCsv,
  listEmployees,
  regeneratePin,
  updateEmployee,
} from '../../services/employees.js';
import {
  archiveJob,
  createJob,
  listJobs,
  unarchiveJob,
  updateJob,
} from '../../services/jobs.js';
import {
  issuePairingCode,
  listKioskDevices,
  renameKioskDevice,
  revokeKioskDevice,
} from '../../services/kiosk-pairing.js';
import {
  inviteMembership,
  listMembershipsForCompany,
  revokeMembership,
  updateMembershipRole,
} from '../../services/memberships.js';
import { Forbidden, Unauthorized } from '../errors.js';
import {
  requireAuth,
  requireCompanyRole,
  requireSuperAdmin,
} from '../middleware/auth.js';

export const companiesRouter: Router = Router({ mergeParams: true });

/** Extract + validate :companyId from the URL. Throws 400 if missing/invalid. */
function companyIdFromParams(req: Request): number {
  const raw = Number(req.params.companyId);
  if (!Number.isFinite(raw) || raw <= 0) throw Forbidden('Company context required');
  return raw;
}

// ---------------------------------------------------------------------------
// Companies (top level)
// ---------------------------------------------------------------------------

// All authenticated users can list companies — the service scopes results.
companiesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const companies = await listCompanies({
      roleGlobal: req.user.roleGlobal,
      userId: req.user.id,
    });
    res.json({ data: companies });
  } catch (err) {
    next(err);
  }
});

companiesRouter.post('/', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const body = createCompanyRequestSchema.parse(req.body);
    const company = await createCompany(body);
    res.status(201).json({ data: company });
  } catch (err) {
    next(err);
  }
});

// Per-company routes below this point run through `assertCompanyAccess`.
async function assertCompanyAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) return next(Unauthorized());
    const companyId = companyIdFromParams(req);
    const ok = await userCanAccessCompany(req.user.id, companyId, req.user.roleGlobal);
    if (!ok) return next(Forbidden('Not a member of this company'));
    next();
  } catch (err) {
    next(err);
  }
}

companiesRouter.get('/:companyId', requireAuth, assertCompanyAccess, async (req, res, next) => {
  try {
    const companyId = companyIdFromParams(req);
    const company = await requireCompany(companyId);
    res.json({ data: company });
  } catch (err) {
    next(err);
  }
});

companiesRouter.patch(
  '/:companyId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = updateCompanyRequestSchema.parse(req.body);
      const company = await updateCompany(companyIdFromParams(req), body);
      res.json({ data: company });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

companiesRouter.get(
  '/:companyId/settings',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const settings = await getCompanySettings(companyIdFromParams(req));
      res.json({ data: settings });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.patch(
  '/:companyId/settings',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = updateCompanySettingsRequestSchema.parse(req.body);
      const settings = await updateCompanySettings(companyIdFromParams(req), body);
      res.json({ data: settings });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

companiesRouter.get(
  '/:companyId/memberships',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const rows = await listMembershipsForCompany(companyIdFromParams(req));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/memberships',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = inviteMembershipRequestSchema.parse(req.body);
      const created = await inviteMembership(companyIdFromParams(req), body);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  },
);

const membershipPatchSchema = z.object({
  role: z.enum(['company_admin', 'supervisor', 'employee']),
});

companiesRouter.patch(
  '/:companyId/memberships/:membershipId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const { role } = membershipPatchSchema.parse(req.body);
      const updated = await updateMembershipRole(
        companyIdFromParams(req),
        Number(req.params.membershipId),
        role,
      );
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.delete(
  '/:companyId/memberships/:membershipId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      await revokeMembership(companyIdFromParams(req), Number(req.params.membershipId));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

const listEmployeesQuerySchema = z.object({
  status: z.enum(['active', 'terminated', 'all']).optional(),
  search: z.string().max(100).optional(),
});

companiesRouter.get(
  '/:companyId/employees',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor'], {
    companyIdFrom: companyIdFromParams,
  }),
  async (req, res, next) => {
    try {
      const q = listEmployeesQuerySchema.parse(req.query);
      const rows = await listEmployees(companyIdFromParams(req), q);
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/employees',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = createEmployeeRequestSchema.parse(req.body);
      const created = await createEmployee(companyIdFromParams(req), body);
      res.status(201).json({ data: created });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/employees/import',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = csvImportRequestSchema.parse(req.body);
      const result = await importEmployeesCsv(companyIdFromParams(req), body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.get(
  '/:companyId/employees/:employeeId',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor'], {
    companyIdFrom: companyIdFromParams,
  }),
  async (req, res, next) => {
    try {
      const row = await getEmployee(
        companyIdFromParams(req),
        Number(req.params.employeeId),
      );
      res.json({ data: row });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.patch(
  '/:companyId/employees/:employeeId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = updateEmployeeRequestSchema.parse(req.body);
      const updated = await updateEmployee(
        companyIdFromParams(req),
        Number(req.params.employeeId),
        body,
      );
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

const regeneratePinBodySchema = z.object({
  length: z.number().int().min(4).max(6).default(6),
});

companiesRouter.post(
  '/:companyId/employees/:employeeId/regenerate-pin',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const { length } = regeneratePinBodySchema.parse(req.body ?? {});
      const result = await regeneratePin(
        companyIdFromParams(req),
        Number(req.params.employeeId),
        length,
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const listJobsQuerySchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

companiesRouter.get(
  '/:companyId/jobs',
  requireAuth,
  assertCompanyAccess,
  async (req, res, next) => {
    try {
      const q = listJobsQuerySchema.parse(req.query);
      const rows = await listJobs(companyIdFromParams(req), {
        includeArchived: !!q.includeArchived,
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/jobs',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = createJobRequestSchema.parse(req.body);
      const job = await createJob(companyIdFromParams(req), body);
      res.status(201).json({ data: job });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.patch(
  '/:companyId/jobs/:jobId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = updateJobRequestSchema.parse(req.body);
      const job = await updateJob(
        companyIdFromParams(req),
        Number(req.params.jobId),
        body,
      );
      res.json({ data: job });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.delete(
  '/:companyId/jobs/:jobId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      await archiveJob(companyIdFromParams(req), Number(req.params.jobId));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/jobs/:jobId/unarchive',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const job = await unarchiveJob(
        companyIdFromParams(req),
        Number(req.params.jobId),
      );
      res.json({ data: job });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Kiosk devices (admin side)
// ---------------------------------------------------------------------------

companiesRouter.get(
  '/:companyId/kiosks',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const rows = await listKioskDevices(companyIdFromParams(req));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/kiosks/pairing-codes',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const body = createKioskPairingCodeRequestSchema.parse(req.body ?? {});
      const result = await issuePairingCode(
        companyIdFromParams(req),
        req.user.id,
        body,
      );
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.patch(
  '/:companyId/kiosks/:deviceId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = renameKioskDeviceRequestSchema.parse(req.body);
      const updated = await renameKioskDevice(
        companyIdFromParams(req),
        Number(req.params.deviceId),
        body.name,
      );
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.delete(
  '/:companyId/kiosks/:deviceId',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      await revokeKioskDevice(
        companyIdFromParams(req),
        Number(req.params.deviceId),
        req.user.id,
      );
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
