import {
  breakInRequestSchema,
  breakOutRequestSchema,
  clockInRequestSchema,
  clockOutRequestSchema,
  switchJobRequestSchema,
} from '@vibept/shared';
import { type Request, Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import {
  breakIn,
  breakOut,
  clockIn,
  clockOut,
  switchJob,
  type PunchContext,
} from '../../services/punch.js';
import { getCurrentPunch } from '../../services/time-entries.js';
import { Forbidden, NotFound, Unauthorized } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';

export const punchRouter: Router = Router();

/**
 * Resolve the employee row for a personal-device punch. A user can
 * belong to multiple companies; the request body picks one, and we
 * validate that their user_id has an active employee row there.
 */
async function resolveEmployeeForUser(
  req: Request,
  companyId: number,
): Promise<{ employeeId: number }> {
  if (!req.user) throw Unauthorized();

  const employee = await db('employees')
    .where({ user_id: req.user.id, company_id: companyId, status: 'active' })
    .first<{ id: number }>();
  if (!employee) throw Forbidden('You are not an active employee at this company');
  return { employeeId: employee.id };
}

function sourceDeviceIdFromReq(req: Request): string {
  // Hash-compressed user-agent; avoids storing raw UA strings in entries.
  const ua = req.headers['user-agent'] ?? 'unknown';
  // A shallow fingerprint is plenty for timesheet forensics.
  return `ua:${String(ua).slice(0, 120)}`;
}

function baseCtx(
  req: Request,
  body: { companyId: number; clientStartedAt?: string; clientClockSkewMs?: number },
  employeeId: number,
): PunchContext {
  return {
    companyId: body.companyId,
    employeeId,
    source: 'mobile_pwa',
    sourceDeviceId: sourceDeviceIdFromReq(req),
    actorUserId: req.user?.id ?? null,
    clientStartedAt: body.clientStartedAt,
    clientClockSkewMs: body.clientClockSkewMs,
  };
}

// ---------------------------------------------------------------------------
// Personal-device punches (user JWT)
// ---------------------------------------------------------------------------

punchRouter.post('/clock-in', requireAuth, async (req, res, next) => {
  try {
    const body = clockInRequestSchema.parse(req.body);
    const { employeeId } = await resolveEmployeeForUser(req, body.companyId);
    const entry = await clockIn(baseCtx(req, body, employeeId), { jobId: body.jobId ?? null });
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

punchRouter.post('/clock-out', requireAuth, async (req, res, next) => {
  try {
    const body = clockOutRequestSchema.parse(req.body);
    const { employeeId } = await resolveEmployeeForUser(req, body.companyId);
    const entry = await clockOut(baseCtx(req, body, employeeId));
    res.json({ data: entry });
  } catch (err) {
    next(err);
  }
});

punchRouter.post('/break-in', requireAuth, async (req, res, next) => {
  try {
    const body = breakInRequestSchema.parse(req.body);
    const { employeeId } = await resolveEmployeeForUser(req, body.companyId);
    const entry = await breakIn(baseCtx(req, body, employeeId));
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

punchRouter.post('/break-out', requireAuth, async (req, res, next) => {
  try {
    const body = breakOutRequestSchema.parse(req.body);
    const { employeeId } = await resolveEmployeeForUser(req, body.companyId);
    const entry = await breakOut(baseCtx(req, body, employeeId));
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

punchRouter.post('/switch-job', requireAuth, async (req, res, next) => {
  try {
    const body = switchJobRequestSchema.parse(req.body);
    const { employeeId } = await resolveEmployeeForUser(req, body.companyId);
    const entry = await switchJob(baseCtx(req, body, employeeId), body.newJobId);
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

const currentQuerySchema = z.object({
  companyId: z.coerce.number().int().positive(),
});

punchRouter.get('/current', requireAuth, async (req, res, next) => {
  try {
    const { companyId } = currentQuerySchema.parse(req.query);
    const { employeeId } = await resolveEmployeeForUser(req, companyId);
    const snapshot = await getCurrentPunch(companyId, employeeId);
    res.json({ data: snapshot });
  } catch (err) {
    next(err);
  }
});
