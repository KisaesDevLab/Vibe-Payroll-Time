// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import {
  copyLastWeekRequestSchema,
  createManualEntryRequestSchema,
  deleteManualEntryRequestSchema,
  updateManualEntryRequestSchema,
} from '@vibept/shared';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db/knex.js';
import {
  copyLastWeek,
  createManualEntry,
  deleteManualEntry,
  updateManualEntry,
} from '../../services/manual-entries.js';
import { Forbidden, Unauthorized } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { isCompanyLoginBlocked } from '../../services/employee-login.js';

export const manualEntriesRouter: Router = Router();

async function assertCallerOwnsCompany(
  userId: number,
  roleGlobal: 'super_admin' | 'none',
  companyId: number,
): Promise<void> {
  if (roleGlobal === 'super_admin') return;
  const membership = await db('company_memberships')
    .where({ user_id: userId, company_id: companyId })
    .first<{ role: string }>();
  if (!membership) throw Forbidden('Not a member of this company');
  if (await isCompanyLoginBlocked(userId, companyId)) {
    throw Forbidden('Your sign-in to this company has been turned off');
  }
}

// ---------------------------------------------------------------------------
// POST /manual-entries — create
// ---------------------------------------------------------------------------

manualEntriesRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = createManualEntryRequestSchema.parse(req.body);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, body.companyId);

    const result = await createManualEntry({
      companyId: body.companyId,
      employeeId: body.employeeId,
      day: body.day,
      jobId: body.jobId,
      durationSeconds: body.durationSeconds,
      reason: body.reason ?? '',
      ...(body.typedInput !== undefined ? { typedInput: body.typedInput } : {}),
      actor: {
        userId: req.user.id,
        roleGlobal: req.user.roleGlobal,
        sourceIp: req.ip ?? null,
        sourceUserAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
      },
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /manual-entries/:id — update duration and/or reason
// ---------------------------------------------------------------------------

manualEntriesRouter.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = updateManualEntryRequestSchema.parse(req.body);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, body.companyId);

    const result = await updateManualEntry({
      entryId: id,
      companyId: body.companyId,
      ...(body.durationSeconds !== undefined ? { durationSeconds: body.durationSeconds } : {}),
      ...(body.reason !== undefined ? { reason: body.reason } : {}),
      ...(body.typedInput !== undefined ? { typedInput: body.typedInput } : {}),
      actor: { userId: req.user.id, roleGlobal: req.user.roleGlobal },
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /manual-entries/:id — soft-delete + restore superseded punches
// ---------------------------------------------------------------------------

manualEntriesRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = deleteManualEntryRequestSchema.parse(req.body);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, body.companyId);

    await deleteManualEntry({
      entryId: id,
      companyId: body.companyId,
      reason: body.reason,
      actor: { userId: req.user.id, roleGlobal: req.user.roleGlobal },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /manual-entries/copy-last-week — bulk duplicate prior week into current
// ---------------------------------------------------------------------------

manualEntriesRouter.post('/copy-last-week', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = copyLastWeekRequestSchema.parse(req.body);
    await assertCallerOwnsCompany(req.user.id, req.user.roleGlobal, body.companyId);

    const result = await copyLastWeek({
      companyId: body.companyId,
      employeeId: body.employeeId,
      weekStart: body.weekStart,
      reason: body.reason,
      actor: {
        userId: req.user.id,
        roleGlobal: req.user.roleGlobal,
        sourceIp: req.ip ?? null,
        sourceUserAgent: req.headers['user-agent']?.slice(0, 512) ?? null,
      },
    });
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});
