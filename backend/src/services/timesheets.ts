// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type {
  ApprovePeriodRequest,
  ApprovePeriodResponse,
  EntryAuditRow,
  PayPeriodType,
  TimesheetResponse,
  TimeEntry,
} from '@vibept/shared';
import { buildTimesheetSummary, resolvePayPeriod } from '@vibept/shared';
import { db } from '../db/knex.js';
import { Forbidden, NotFound } from '../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from './punch.js';

interface CompanyCtx {
  id: number;
  timezone: string;
  weekStartDay: number;
  payPeriodType: PayPeriodType;
  payPeriodAnchor: Date | null;
}

async function loadCompanyCtx(companyId: number): Promise<CompanyCtx> {
  const row = await db('companies').where({ id: companyId }).first<{
    id: number;
    timezone: string;
    week_start_day: number;
    pay_period_type: PayPeriodType;
    pay_period_anchor: Date | null;
  }>();
  if (!row) throw NotFound('Company not found');
  return {
    id: row.id,
    timezone: row.timezone,
    weekStartDay: row.week_start_day,
    payPeriodType: row.pay_period_type,
    payPeriodAnchor: row.pay_period_anchor,
  };
}

async function loadSettings(companyId: number): Promise<{
  roundingMode: 'none' | '1min' | '5min' | '6min' | '15min';
  roundingGraceMinutes: number;
}> {
  const row = await db('company_settings').where({ company_id: companyId }).first<{
    punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
    punch_rounding_grace_minutes: number;
  }>();
  if (!row) throw NotFound('Company settings not found');
  return {
    roundingMode: row.punch_rounding_mode,
    roundingGraceMinutes: row.punch_rounding_grace_minutes,
  };
}

/**
 * Build the timesheet for one employee over a pay period. Period is
 * either passed in explicitly by the caller or resolved from the company
 * settings + the current date ("current pay period").
 */
export async function getTimesheet(
  companyId: number,
  employeeId: number,
  opts: { periodStart?: Date; periodEnd?: Date } = {},
): Promise<TimesheetResponse> {
  const employee = await db('employees')
    .where({ id: employeeId, company_id: companyId })
    .first<{ id: number; first_name: string; last_name: string; timezone: string | null }>();
  if (!employee) throw NotFound('Employee not found');

  const company = await loadCompanyCtx(companyId);
  const settings = await loadSettings(companyId);

  // Phase 14.2 — `employee.timezone` exists on the row (introduced by
  // migration 20260420000037) so we read it here, but we deliberately
  // do NOT pass it to `buildTimesheetSummary`:
  //   - Pay-period and FLSA workweek boundaries are legally per-
  //     EMPLOYER, not per-employee. Letting an employee's TZ shift
  //     the OT workweek would be wage-and-hour-claim surface.
  //   - Day grouping in summaries is shared between employee-facing
  //     and admin views; rendering different days per viewer would
  //     desync.
  // The per-employee TZ instead surfaces at the per-row formatting
  // layer in the UI ("you punched in at 9:00 AM in your time"). That
  // formatting is consumer-side and reads `employee.timezone`
  // directly from the response. v1 does not surface that field yet;
  // the column is plumbed for the future formatter.
  void employee.timezone;

  let periodStart: Date;
  let periodEnd: Date;
  if (opts.periodStart && opts.periodEnd) {
    periodStart = opts.periodStart;
    periodEnd = opts.periodEnd;
  } else {
    const resolved = resolvePayPeriod(new Date(), {
      type: company.payPeriodType,
      weekStartDay: company.weekStartDay,
      ...(company.payPeriodAnchor ? { anchorDate: company.payPeriodAnchor } : {}),
      timezone: company.timezone,
    });
    periodStart = resolved.start;
    periodEnd = resolved.end;
  }

  const rows = await db<TimeEntryRow>('time_entries')
    .where({ company_id: companyId, employee_id: employeeId })
    .whereNull('deleted_at')
    // Entries that overlap the period (start < end AND end > start).
    .where(function () {
      this.whereNull('ended_at').orWhere('ended_at', '>', periodStart);
    })
    .where('started_at', '<', periodEnd)
    .orderBy('started_at', 'asc');

  const entries: TimeEntry[] = rows.map(rowToTimeEntry);

  const summary = buildTimesheetSummary(
    entries.map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      shiftId: e.shiftId,
      entryType: e.entryType,
      jobId: e.jobId,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
    })),
    {
      timezone: company.timezone,
      weekStartDay: company.weekStartDay,
      roundingMode: settings.roundingMode,
      roundingGraceMinutes: settings.roundingGraceMinutes,
      periodStart,
      periodEnd,
    },
  );

  const allApproved = entries.length > 0 && entries.every((e) => !!e.approvedAt && !!e.endedAt);
  const approvedAt = allApproved
    ? entries.reduce<string | null>((latest, e) => {
        if (!e.approvedAt) return latest;
        if (!latest || e.approvedAt > latest) return e.approvedAt;
        return latest;
      }, null)
    : null;

  return {
    employee: {
      id: employee.id,
      firstName: employee.first_name,
      lastName: employee.last_name,
      companyId,
    },
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      type: company.payPeriodType,
    },
    entries,
    days: summary.days,
    weeks: summary.weeks,
    totals: {
      workSeconds: summary.periodTotal.workSeconds,
      breakSeconds: summary.periodTotal.breakSeconds,
      regularSeconds: summary.periodTotal.regularSeconds,
      overtimeSeconds: summary.periodTotal.overtimeSeconds,
    },
    jobBreakdown: summary.jobBreakdown,
    isApproved: allApproved,
    approvedAt,
  };
}

/**
 * Approve every *closed* entry for the given employees in the given
 * window. Open entries can't be approved (can't sign off on a running
 * shift). Already-approved entries are left alone.
 */
export async function approvePeriod(
  companyId: number,
  actor: { userId: number; roleGlobal: 'super_admin' | 'none' },
  body: ApprovePeriodRequest,
): Promise<ApprovePeriodResponse> {
  const periodStart = new Date(body.periodStart);
  const periodEnd = new Date(body.periodEnd);

  return db.transaction(async (trx) => {
    const rows = await trx<TimeEntryRow>('time_entries')
      .where({ company_id: companyId })
      .whereIn('employee_id', body.employeeIds)
      .whereNotNull('ended_at')
      .whereNull('approved_at')
      .whereNull('deleted_at')
      .where('started_at', '>=', periodStart)
      .where('started_at', '<', periodEnd)
      .select<Array<{ id: number; employee_id: number }>>('id', 'employee_id');

    if (rows.length === 0) return { approvedEntryCount: 0, affectedEmployeeIds: [] };

    const ids = rows.map((r) => r.id);
    await trx('time_entries').whereIn('id', ids).update({
      approved_at: trx.fn.now(),
      approved_by: actor.userId,
      updated_at: trx.fn.now(),
    });

    // One audit row per approved entry so the trail is complete.
    const auditRows = ids.map((id) => ({
      time_entry_id: id,
      company_id: companyId,
      actor_user_id: actor.userId,
      action: 'approve' as const,
    }));
    await trx('time_entry_audit').insert(auditRows);

    const affected = Array.from(new Set(rows.map((r) => r.employee_id)));
    return { approvedEntryCount: ids.length, affectedEmployeeIds: affected };
  });
}

export async function unapprovePeriod(
  companyId: number,
  actor: { userId: number },
  body: ApprovePeriodRequest,
): Promise<{ unapprovedEntryCount: number }> {
  const periodStart = new Date(body.periodStart);
  const periodEnd = new Date(body.periodEnd);

  return db.transaction(async (trx) => {
    const rows = await trx<TimeEntryRow>('time_entries')
      .where({ company_id: companyId })
      .whereIn('employee_id', body.employeeIds)
      .whereNotNull('approved_at')
      .whereNull('deleted_at')
      .where('started_at', '>=', periodStart)
      .where('started_at', '<', periodEnd)
      .select<Array<{ id: number }>>('id');

    if (rows.length === 0) return { unapprovedEntryCount: 0 };

    const ids = rows.map((r) => r.id);
    await trx('time_entries').whereIn('id', ids).update({
      approved_at: null,
      approved_by: null,
      updated_at: trx.fn.now(),
    });

    await trx('time_entry_audit').insert(
      ids.map((id) => ({
        time_entry_id: id,
        company_id: companyId,
        actor_user_id: actor.userId,
        action: 'unapprove' as const,
      })),
    );

    return { unapprovedEntryCount: ids.length };
  });
}

// ---------------------------------------------------------------------------
// Audit trail reader
// ---------------------------------------------------------------------------

export async function getEntryAudit(companyId: number, entryId: number): Promise<EntryAuditRow[]> {
  const rows = await db('time_entry_audit as a')
    .leftJoin('users as u', 'u.id', 'a.actor_user_id')
    .where({ 'a.time_entry_id': entryId, 'a.company_id': companyId })
    .orderBy('a.created_at', 'asc')
    .select<
      Array<{
        id: number;
        action: EntryAuditRow['action'];
        field: string | null;
        old_value: unknown;
        new_value: unknown;
        reason: string | null;
        actor_user_id: number | null;
        actor_email: string | null;
        created_at: Date;
      }>
    >('a.id', 'a.action', 'a.field', 'a.old_value', 'a.new_value', 'a.reason', 'a.actor_user_id', 'u.email as actor_email', 'a.created_at');

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    field: r.field,
    oldValue: r.old_value,
    newValue: r.new_value,
    reason: r.reason,
    actorUserId: r.actor_user_id,
    actorEmail: r.actor_email,
    createdAt: r.created_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Edit authorization matrix (CLAUDE.md Phase 6 requirements)
// ---------------------------------------------------------------------------

export interface EditAuthContext {
  userId: number;
  roleGlobal: 'super_admin' | 'none';
  companyRole: 'company_admin' | 'supervisor' | 'employee' | null;
  /** Is the actor the employee whose entry this is? */
  isOwnEntry: boolean;
  /** Is the entry currently approved? */
  isApproved: boolean;
}

export function canEditEntry(ctx: EditAuthContext): boolean {
  if (ctx.roleGlobal === 'super_admin') return true;
  if (!ctx.companyRole) return false;

  switch (ctx.companyRole) {
    case 'company_admin':
    case 'supervisor':
      return true; // can edit any, approved or not
    case 'employee':
      return ctx.isOwnEntry && !ctx.isApproved;
  }
}

export function canDeleteEntry(ctx: EditAuthContext): boolean {
  if (ctx.roleGlobal === 'super_admin') return true;
  return ctx.companyRole === 'company_admin';
}

export async function loadEditContext(
  actor: { userId: number; roleGlobal: 'super_admin' | 'none' },
  companyId: number,
  entryId: number,
): Promise<EditAuthContext> {
  const entry = await db<TimeEntryRow>('time_entries')
    .where({ id: entryId, company_id: companyId })
    .first();
  if (!entry) throw NotFound('Time entry not found');

  const membership = await db('company_memberships')
    .where({ user_id: actor.userId, company_id: companyId })
    .first<{ role: 'company_admin' | 'supervisor' | 'employee' }>();

  const employee = await db('employees')
    .where({ id: entry.employee_id })
    .first<{ user_id: number | null }>();

  return {
    userId: actor.userId,
    roleGlobal: actor.roleGlobal,
    companyRole: membership?.role ?? null,
    isOwnEntry: employee?.user_id === actor.userId,
    isApproved: !!entry.approved_at,
  };
}

export function assertCanEdit(ctx: EditAuthContext): void {
  if (!canEditEntry(ctx)) throw Forbidden('Not allowed to edit this entry');
}

export function assertCanDelete(ctx: EditAuthContext): void {
  if (!canDeleteEntry(ctx)) throw Forbidden('Not allowed to delete this entry');
}

/**
 * Company-scoped permission check for creating an entry on behalf of an
 * employee (the "missed punch" supervisor flow). Mirrors
 * canEditEntry/canDeleteEntry but without needing an existing entry.
 */
export async function loadCompanyEditContext(
  actor: { userId: number; roleGlobal: 'super_admin' | 'none' },
  companyId: number,
): Promise<{
  roleGlobal: 'super_admin' | 'none';
  companyRole: 'company_admin' | 'supervisor' | 'employee' | null;
}> {
  const membership = await db('company_memberships')
    .where({ user_id: actor.userId, company_id: companyId })
    .first<{ role: 'company_admin' | 'supervisor' | 'employee' }>();
  return { roleGlobal: actor.roleGlobal, companyRole: membership?.role ?? null };
}

export function assertCanAddEntry(ctx: {
  roleGlobal: 'super_admin' | 'none';
  companyRole: 'company_admin' | 'supervisor' | 'employee' | null;
}): void {
  if (ctx.roleGlobal === 'super_admin') return;
  if (ctx.companyRole === 'company_admin' || ctx.companyRole === 'supervisor') return;
  throw Forbidden('Not allowed to create entries for this company');
}
