import {
  kioskClockInRequestSchema,
  kioskPunchRequestSchema,
  kioskSwitchJobRequestSchema,
  kioskVerifyPinRequestSchema,
  pairKioskRequestSchema,
} from '@vibept/shared';
import { type Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/knex.js';
import { pairKiosk } from '../../services/kiosk-pairing.js';
import { kioskVerifyPin } from '../../services/kiosk-verify.js';
import {
  breakIn,
  breakOut,
  clockIn,
  clockOut,
  switchJob,
  type PunchContext,
} from '../../services/punch.js';
import { getCurrentPunch } from '../../services/time-entries.js';
import { Unauthorized } from '../errors.js';
import { requireKioskDevice, requireKioskEmployee } from '../middleware/kiosk-auth.js';

export const kioskRouter: Router = Router();

// Pairing is public (no auth) — the one-time code IS the auth factor.
// Rate-limit to deter online brute-force of the 8-digit code.
const pairLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many pairing attempts. Please retry shortly.',
    },
  },
});

kioskRouter.post('/pair', pairLimiter, async (req, res, next) => {
  try {
    const body = pairKioskRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const result = await pairKiosk(body, ctx);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

kioskRouter.get('/me', requireKioskDevice, async (req, res, next) => {
  try {
    if (!req.kioskDevice) return next(Unauthorized());
    res.json({
      data: {
        id: req.kioskDevice.id,
        companyId: req.kioskDevice.companyId,
        name: req.kioskDevice.name,
      },
    });
  } catch (err) {
    next(err);
  }
});

kioskRouter.post('/verify-pin', requireKioskDevice, async (req, res, next) => {
  try {
    if (!req.kioskDevice) return next(Unauthorized());
    const body = kioskVerifyPinRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const result = await kioskVerifyPin(req.kioskDevice, body.pin, ctx);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Kiosk punch endpoints — both layers of auth required. The employee was
// PIN-verified for this device in the last 5 minutes; the session token
// carries employeeId so we don't re-read the employee row here.
// ---------------------------------------------------------------------------

async function resolveEmployeeForKiosk(
  req: Request,
): Promise<{ companyId: number; employeeId: number; userId: number | null }> {
  if (!req.kioskDevice || !req.kioskEmployee) {
    throw Unauthorized('Kiosk employee session required');
  }
  // The employee row may have a user_id we want to record as the actor.
  const employee = await db('employees')
    .where({ id: req.kioskEmployee.employeeId, company_id: req.kioskDevice.companyId })
    .first<{ id: number; user_id: number | null; status: string }>();
  if (!employee || employee.status !== 'active') {
    throw Unauthorized('Employee no longer active');
  }
  return {
    companyId: req.kioskDevice.companyId,
    employeeId: employee.id,
    userId: employee.user_id,
  };
}

function kioskCtx(
  req: Request,
  ids: { companyId: number; employeeId: number; userId: number | null },
  body: { clientStartedAt?: string; clientClockSkewMs?: number },
): PunchContext {
  return {
    companyId: ids.companyId,
    employeeId: ids.employeeId,
    source: 'kiosk',
    sourceDeviceId: req.kioskDevice ? `kiosk:${req.kioskDevice.id}` : null,
    actorUserId: ids.userId,
    clientStartedAt: body.clientStartedAt,
    clientClockSkewMs: body.clientClockSkewMs,
  };
}

const bothAuthed = [requireKioskDevice, requireKioskEmployee] as const;

kioskRouter.post('/punch/clock-in', ...bothAuthed, async (req, res, next) => {
  try {
    const body = kioskClockInRequestSchema.parse(req.body ?? {});
    const ids = await resolveEmployeeForKiosk(req);
    const entry = await clockIn(kioskCtx(req, ids, body), { jobId: body.jobId ?? null });
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

kioskRouter.post('/punch/clock-out', ...bothAuthed, async (req, res, next) => {
  try {
    const body = kioskPunchRequestSchema.parse(req.body ?? {});
    const ids = await resolveEmployeeForKiosk(req);
    const entry = await clockOut(kioskCtx(req, ids, body));
    res.json({ data: entry });
  } catch (err) {
    next(err);
  }
});

kioskRouter.post('/punch/break-in', ...bothAuthed, async (req, res, next) => {
  try {
    const body = kioskPunchRequestSchema.parse(req.body ?? {});
    const ids = await resolveEmployeeForKiosk(req);
    const entry = await breakIn(kioskCtx(req, ids, body));
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

kioskRouter.post('/punch/break-out', ...bothAuthed, async (req, res, next) => {
  try {
    const body = kioskPunchRequestSchema.parse(req.body ?? {});
    const ids = await resolveEmployeeForKiosk(req);
    const entry = await breakOut(kioskCtx(req, ids, body));
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

kioskRouter.post('/punch/switch-job', ...bothAuthed, async (req, res, next) => {
  try {
    const body = kioskSwitchJobRequestSchema.parse(req.body);
    const ids = await resolveEmployeeForKiosk(req);
    const entry = await switchJob(kioskCtx(req, ids, body), body.newJobId);
    res.status(201).json({ data: entry });
  } catch (err) {
    next(err);
  }
});

kioskRouter.get('/punch/current', ...bothAuthed, async (req, res, next) => {
  try {
    const ids = await resolveEmployeeForKiosk(req);
    const snapshot = await getCurrentPunch(ids.companyId, ids.employeeId);
    res.json({ data: snapshot });
  } catch (err) {
    next(err);
  }
});
