// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import {
  kioskClockInRequestSchema,
  kioskClockOutRequestSchema,
  kioskPunchRequestSchema,
  kioskScanRequestSchema,
  kioskSwitchJobRequestSchema,
  kioskVerifyPinRequestSchema,
  pairKioskRequestSchema,
} from '@vibept/shared';
import { type Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../../db/knex.js';
import { verifyBadge } from '../../services/badges.js';
import { pairKiosk } from '../../services/kiosk-pairing.js';
import { kioskVerifyPin } from '../../services/kiosk-verify.js';
import {
  breakIn,
  breakOut,
  clockIn,
  clockOut,
  getTodayWorkSeconds,
  switchJob,
  type PunchContext,
} from '../../services/punch.js';
import { recordAuthEvent } from '../../services/auth-events.js';
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
    // Fetch the auth mode + company name with a single join so the tablet
    // re-renders to the right scanner/keypad state on every reload and
    // after any admin flip of the setting.
    const row = await db('company_settings')
      .join('companies', 'companies.id', 'company_settings.company_id')
      .where({ 'company_settings.company_id': req.kioskDevice.companyId })
      .first<{
        kiosk_auth_mode: 'pin' | 'qr' | 'both';
        lunch_prompt_enabled: boolean;
        time_format_default: 'decimal' | 'hhmm' | null;
        name: string;
      }>('company_settings.kiosk_auth_mode', 'company_settings.lunch_prompt_enabled', 'company_settings.time_format_default', 'companies.name');
    res.json({
      data: {
        id: req.kioskDevice.id,
        companyId: req.kioskDevice.companyId,
        name: req.kioskDevice.name,
        companyName: row?.name ?? '',
        kioskAuthMode: row?.kiosk_auth_mode ?? 'pin',
        lunchPromptEnabled: row?.lunch_prompt_enabled ?? true,
        timeFormat: row?.time_format_default ?? 'decimal',
      },
    });
  } catch (err) {
    next(err);
  }
});

// The tablet unpairs itself: revoke its own device token so the copy in
// the tablet's storage is dead server-side, not merely forgotten locally.
// Device-authenticated only — the token being revoked is the credential.
kioskRouter.post('/unpair', requireKioskDevice, async (req, res, next) => {
  try {
    if (!req.kioskDevice) return next(Unauthorized());
    await db('kiosk_devices')
      .where({ id: req.kioskDevice.id, company_id: req.kioskDevice.companyId })
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
    await recordAuthEvent({
      eventType: 'logout',
      companyId: req.kioskDevice.companyId,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      metadata: { kiosk_device_id: req.kioskDevice.id, action: 'kiosk_self_unpair' },
    });
    res.status(204).end();
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

// Scan a QR badge. Returns the same KioskEmployeeContext as /verify-pin so
// the kiosk UI can hand it straight to the punch-action screen.
kioskRouter.post('/scan', requireKioskDevice, async (req, res, next) => {
  try {
    if (!req.kioskDevice) return next(Unauthorized());
    const body = kioskScanRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const result = await verifyBadge(req.kioskDevice, body.payload, ctx);
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
    sourceIp: req.ip ?? null,
    sourceUserAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
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
    const body = kioskClockOutRequestSchema.parse(req.body ?? {});
    const ids = await resolveEmployeeForKiosk(req);
    const entry = await clockOut(kioskCtx(req, ids, body), { lunchMinutes: body.lunchMinutes });
    // Read after the close so the total includes the shift just ended
    // (and the lunch split, if the prompt made one) for the confirmation.
    // The punch is already committed: a failed read must not turn it into an
    // error the employee "retries" into a conflict. Omit the total instead.
    const todayWorkSeconds = await getTodayWorkSeconds(ids.companyId, ids.employeeId).catch(
      () => undefined,
    );
    res.json({ data: { ...entry, todayWorkSeconds } });
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
