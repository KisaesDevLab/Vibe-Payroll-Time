import {
  approvePeriodRequestSchema,
  createCorrectionRequestSchema,
  createEntryRequestSchema,
  decideCorrectionRequestSchema,
  deleteEntryRequestSchema,
  editEntryRequestSchema,
  timesheetQuerySchema,
} from '@vibept/shared';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import {
  approveCorrectionRequest,
  createCorrectionRequest,
  listCorrectionRequests,
  rejectCorrectionRequest,
} from '../../services/correction-requests.js';
import {
  createEntryForEmployee,
  deleteEntry,
  editEntry,
  type EditEntryPatch,
} from '../../services/punch.js';
import {
  approvePeriod,
  assertCanAddEntry,
  assertCanDelete,
  assertCanEdit,
  getEntryAudit,
  getTimesheet,
  loadCompanyEditContext,
  loadEditContext,
  unapprovePeriod,
} from '../../services/timesheets.js';
import { Forbidden, Unauthorized } from '../errors.js';
import { requireAuth, requireCompanyRole } from '../middleware/auth.js';

export const timesheetsRouter: Router = Router();

/**
 * Shared helper: extract companyId from query/body and check the caller
 * can access that company. Because timesheet endpoints have varied
 * companyId surfaces (query, body), we do this at the handler level
 * instead of via middleware.
 */
async function assertCallerOwnsCompany(
  userId: number,
  roleGlobal: 'super_admin' | 'none',
  companyId: number,
  minRole?: 'company_admin' | 'supervisor' | 'employee',
): Promise<'company_admin' | 'supervisor' | 'employee' | null> {
  if (roleGlobal === 'super_admin') return null;
  const membership = await db('company_memberships')
    .where({ user_id: userId, company_id: companyId })
    .first<{ role: 'company_admin' | 'supervisor' | 'employee' }>();
  if (!membership) throw Forbidden('Not a member of this company');
  if (minRole) {
    const rank = { employee: 1, supervisor: 2, company_admin: 3 };
    if (rank[membership.role] < rank[minRole]) throw Forbidden('Insufficient role');
  }
  return membership.role;
}

// ---------------------------------------------------------------------------
// Timesheet reads
// ---------------------------------------------------------------------------

timesheetsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const q = timesheetQuerySchema.parse(req.query);

    // Employees can only read their own timesheet; supervisors+ can read any
    // employee in companies they belong to.
    const role = await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, q.companyId);
    if (role === 'employee' && req.user.roleGlobal !== 'super_admin') {
      const ownEmployee = await db('employees')
        .where({ company_id: q.companyId, user_id: req.user.id })
        .first<{ id: number }>();
      if (!ownEmployee || ownEmployee.id !== q.employeeId) {
        return next(Forbidden("Cannot read another employee's timesheet"));
      }
    }

    const result = await getTimesheet(q.companyId, q.employeeId, {
      ...(q.periodStart ? { periodStart: new Date(q.periodStart) } : {}),
      ...(q.periodEnd ? { periodEnd: new Date(q.periodEnd) } : {}),
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/** Employee's own current pay period — convenience shortcut. */
timesheetsRouter.get('/current', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) return next(Forbidden('companyId required'));

    const employee = await db('employees')
      .where({ company_id: companyId, user_id: req.user.id, status: 'active' })
      .first<{ id: number }>();
    if (!employee) return next(Forbidden('Not an active employee at this company'));

    const result = await getTimesheet(companyId, employee.id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

const approveQuery = z.object({ companyId: z.coerce.number().int().positive() });

timesheetsRouter.post('/approve', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, companyId, 'supervisor');
    const body = approvePeriodRequestSchema.parse(req.body);
    const result = await approvePeriod(
      companyId,
      { userId: req.user.id, roleGlobal: req.user.roleGlobal },
      body,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

timesheetsRouter.post('/unapprove', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, companyId, 'supervisor');
    const body = approvePeriodRequestSchema.parse(req.body);
    const result = await unapprovePeriod(companyId, { userId: req.user.id }, body);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Entry edit + delete — authorized via edit matrix
// ---------------------------------------------------------------------------

timesheetsRouter.post('/entries', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    const body = createEntryRequestSchema.parse(req.body);

    const ctx = await loadCompanyEditContext(
      { userId: req.user.id, roleGlobal: req.user.roleGlobal },
      companyId,
    );
    assertCanAddEntry(ctx);

    const entry = await createEntryForEmployee(body, {
      userId: req.user.id,
      companyId,
      sourceIp: req.ip ?? null,
      sourceUserAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
    });
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

timesheetsRouter.patch('/entries/:entryId', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    const body = editEntryRequestSchema.parse(req.body);
    const entryId = Number(req.params.entryId);

    const ctx = await loadEditContext(
      { userId: req.user.id, roleGlobal: req.user.roleGlobal },
      companyId,
      entryId,
    );
    assertCanEdit(ctx);

    const patch: EditEntryPatch = {};
    if (body.startedAt !== undefined) patch.startedAt = body.startedAt;
    if (body.endedAt !== undefined) patch.endedAt = body.endedAt;
    if (body.jobId !== undefined) patch.jobId = body.jobId;
    if (body.entryType !== undefined) patch.entryType = body.entryType;

    const updated = await editEntry(
      entryId,
      patch,
      { userId: req.user.id, companyId },
      body.reason,
    );
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

timesheetsRouter.delete('/entries/:entryId', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    const body = deleteEntryRequestSchema.parse(req.body ?? {});
    const entryId = Number(req.params.entryId);

    const ctx = await loadEditContext(
      { userId: req.user.id, roleGlobal: req.user.roleGlobal },
      companyId,
      entryId,
    );
    assertCanDelete(ctx);

    await deleteEntry(entryId, { userId: req.user.id, companyId }, body.reason);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

timesheetsRouter.get('/entries/:entryId/audit', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, companyId);
    const rows = await getEntryAudit(companyId, Number(req.params.entryId));
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Correction requests (nested by company for admin read, flat for
// employee-initiated create)
// ---------------------------------------------------------------------------

export const correctionsRouter: Router = Router({ mergeParams: true });

correctionsRouter.get(
  '/:companyId/correction-requests',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor']),
  async (req, res, next) => {
    try {
      const companyId = Number(req.params.companyId);
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const allowedStatus =
        status && ['pending', 'approved', 'rejected'].includes(status)
          ? (status as 'pending' | 'approved' | 'rejected')
          : undefined;
      const rows = await listCorrectionRequests(companyId, {
        ...(allowedStatus ? { status: allowedStatus } : {}),
      });
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

// Employee creates a request — scoped to the acting user's employee row.
timesheetsRouter.post('/correction-requests', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const { companyId } = approveQuery.parse(req.query);
    const body = createCorrectionRequestSchema.parse(req.body);

    const employee = await db('employees')
      .where({ company_id: companyId, user_id: req.user.id, status: 'active' })
      .first<{ id: number }>();
    if (!employee) return next(Forbidden('Not an active employee at this company'));

    const created = await createCorrectionRequest(companyId, employee.id, req.user.id, body);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

correctionsRouter.post(
  '/:companyId/correction-requests/:id/approve',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor']),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const companyId = Number(req.params.companyId);
      const id = Number(req.params.id);
      const body = decideCorrectionRequestSchema.parse(req.body ?? {});
      const result = await approveCorrectionRequest(companyId, id, { userId: req.user.id }, body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

correctionsRouter.post(
  '/:companyId/correction-requests/:id/reject',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor']),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const companyId = Number(req.params.companyId);
      const id = Number(req.params.id);
      const body = decideCorrectionRequestSchema.parse(req.body ?? {});
      const result = await rejectCorrectionRequest(companyId, id, { userId: req.user.id }, body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);
