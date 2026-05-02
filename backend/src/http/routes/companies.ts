// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import {
  bulkIssueBadgesRequestSchema,
  createCompanyRequestSchema,
  createEmployeeRequestSchema,
  createJobRequestSchema,
  createKioskPairingCodeRequestSchema,
  csvImportRequestSchema,
  inviteMembershipRequestSchema,
  renameKioskDeviceLocationRequestSchema,
  renameKioskDeviceRequestSchema,
  revokeBadgeRequestSchema,
  setEmployeePinRequestSchema,
  updateCompanyRequestSchema,
  updateCompanySettingsRequestSchema,
  updateEmployeeRequestSchema,
  updateJobRequestSchema,
} from '@vibept/shared';
import { type Request, type Response, type NextFunction, Router } from 'express';
import { z } from 'zod';
import {
  bulkIssueBadges,
  getBadgeState,
  issueBadge,
  listBadgeEventsForEmployee,
  revokeBadge,
} from '../../services/badges.js';
import { renderBadgeSheet } from '../../services/badge-sheet.js';
import {
  createCompany,
  listCompanies,
  requireCompany,
  setCompanyActive,
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
  setEmployeePinManually,
  updateEmployee,
} from '../../services/employees.js';
import { archiveJob, createJob, listJobs, unarchiveJob, updateJob } from '../../services/jobs.js';
import {
  issuePairingCode,
  listKioskDevices,
  renameKioskDevice,
  revokeKioskDevice,
  setKioskDeviceLocation,
} from '../../services/kiosk-pairing.js';
import {
  inviteMembership,
  listMembershipsForCompany,
  revokeMembership,
  updateMembershipRole,
} from '../../services/memberships.js';
import { Forbidden, Unauthorized } from '../errors.js';
import { requireAuth, requireCompanyRole, requireSuperAdmin } from '../middleware/auth.js';

export const companiesRouter: Router = Router({ mergeParams: true });

/** Extract + validate :companyId from the URL. Throws 400 if missing/invalid. */
function companyIdFromParams(req: Request): number {
  const raw = Number(req.params.companyId);
  if (!Number.isFinite(raw) || raw <= 0) throw Forbidden('Company context required');
  return raw;
}

/** True iff the caller is company_admin for this company (or a SuperAdmin).
 *  Supervisors return false — used to gate PIN plaintext reveal so a
 *  supervisor can't walk the kiosk as another employee. */
async function callerIsCompanyAdmin(
  userId: number,
  roleGlobal: 'super_admin' | 'none',
  companyId: number,
): Promise<boolean> {
  return userCanAccessCompany(userId, companyId, roleGlobal, 'company_admin');
}

// ---------------------------------------------------------------------------
// Companies (top level)
// ---------------------------------------------------------------------------

// All authenticated users can list companies — the service scopes results
// to companies the caller is a member of. Sensitive commercial detail
// (license claims / tier / seat cap) is NOT in this payload — it only
// surfaces via /api/v1/companies/:id/license, which gates claims on
// company_admin role.
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
async function assertCompanyAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
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

// SuperAdmin-only active/inactive toggle. "Inactive" is a soft flag that
// hides the company from default views and excludes it from license
// counts — data is preserved for audit / export.
const companyStatusBodySchema = z.object({ active: z.boolean() });
companiesRouter.post(
  '/:companyId/status',
  requireAuth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      const { active } = companyStatusBodySchema.parse(req.body);
      const company = await setCompanyActive(companyIdFromParams(req), active);
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
      if (!req.user) return next(Unauthorized());
      const q = listEmployeesQuerySchema.parse(req.query);
      // Plaintext PIN visibility is company_admin + SuperAdmin only. A
      // supervisor who can see every employee's PIN could walk up to the
      // kiosk and punch in as anyone — defeating the kiosk's anti-buddy
      // -punching posture (the product relies on PIN confidentiality;
      // there is no GPS / photo / biometric backstop by design). The
      // Employee row still carries `hasPin: true/false`; supervisors use
      // that plus the "regenerate PIN" action (company_admin-only) to
      // help forgetful employees.
      const includePin = await callerIsCompanyAdmin(
        req.user.id,
        req.user.roleGlobal,
        companyIdFromParams(req),
      );
      const rows = await listEmployees(companyIdFromParams(req), { ...q, includePin });
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
      if (!req.user) return next(Unauthorized());
      // Same rule as the list endpoint: plaintext PIN is company_admin
      // (+ SuperAdmin) only.
      const includePin = await callerIsCompanyAdmin(
        req.user.id,
        req.user.roleGlobal,
        companyIdFromParams(req),
      );
      const row = await getEmployee(companyIdFromParams(req), Number(req.params.employeeId), {
        includePin,
      });
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

// Admin sets an employee's PIN manually. Same authorization as
// regenerate; the service validates shape + weak-pattern.
companiesRouter.put(
  '/:companyId/employees/:employeeId/pin',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = setEmployeePinRequestSchema.parse(req.body);
      const result = await setEmployeePinManually(
        companyIdFromParams(req),
        Number(req.params.employeeId),
        body.pin,
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

companiesRouter.get(
  '/:companyId/employees/:employeeId/badge',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor'], {
    companyIdFrom: companyIdFromParams,
  }),
  async (req, res, next) => {
    try {
      const state = await getBadgeState(companyIdFromParams(req), Number(req.params.employeeId));
      res.json({ data: state });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/employees/:employeeId/badge/issue',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const result = await issueBadge(
        companyIdFromParams(req),
        Number(req.params.employeeId),
        req.user.id,
      );
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.post(
  '/:companyId/employees/:employeeId/badge/revoke',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const body = revokeBadgeRequestSchema.parse(req.body ?? {});
      const state = await revokeBadge(
        companyIdFromParams(req),
        Number(req.params.employeeId),
        req.user.id,
        body.reason,
      );
      res.json({ data: state });
    } catch (err) {
      next(err);
    }
  },
);

companiesRouter.get(
  '/:companyId/employees/:employeeId/badge/events',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor'], {
    companyIdFrom: companyIdFromParams,
  }),
  async (req, res, next) => {
    try {
      const events = await listBadgeEventsForEmployee(
        companyIdFromParams(req),
        Number(req.params.employeeId),
      );
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  },
);

// Bulk issue. Returns the rendered HTML sheet directly so the admin can
// hit File → Print to produce the badges in one round trip. The sheet
// embeds every just-minted payload, so there is no second call that could
// leak or re-read them.
companiesRouter.post(
  '/:companyId/employees/bulk-badges',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const body = bulkIssueBadgesRequestSchema.parse(req.body);
      const companyId = companyIdFromParams(req);
      const result = await bulkIssueBadges(companyId, body.employeeIds, req.user.id);
      const company = await requireCompany(companyId);
      const html = await renderBadgeSheet({
        companyName: company.name,
        entries: result.issued.map((e) => ({
          employeeId: e.employeeId,
          firstName: e.firstName,
          lastName: e.lastName,
          employeeNumber: e.employeeNumber,
          payload: e.payload,
          version: e.version,
        })),
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Don't leak payloads through the proxy or browser caches.
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Badges-Issued', String(result.issued.length));
      res.setHeader('X-Badges-Skipped', String(result.skipped.length));
      res.send(html);
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
      const job = await updateJob(companyIdFromParams(req), Number(req.params.jobId), body);
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
      const job = await unarchiveJob(companyIdFromParams(req), Number(req.params.jobId));
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
      const result = await issuePairingCode(companyIdFromParams(req), req.user.id, body);
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

companiesRouter.patch(
  '/:companyId/kiosks/:deviceId/location',
  requireAuth,
  requireCompanyRole(['company_admin'], { companyIdFrom: companyIdFromParams }),
  async (req, res, next) => {
    try {
      const body = renameKioskDeviceLocationRequestSchema.parse(req.body);
      const updated = await setKioskDeviceLocation(
        companyIdFromParams(req),
        Number(req.params.deviceId),
        body.locationLabel,
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
      await revokeKioskDevice(companyIdFromParams(req), Number(req.params.deviceId), req.user.id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
