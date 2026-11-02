// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Missing-time reminders.
 *
 * A "missing day" is one of an employee's expected work days in a pay
 * period — the employee's own `work_days`, else the company's — that is
 * on or after their hire date, before today (company time), and has no
 * work or time-off entry at all. Any entry covers the day; a short day
 * is not "missing". Breaks don't count.
 *
 * Two ways a reminder goes out:
 *   - `runMissingTimeSweep` (hourly job): for companies that turned
 *     reminders on, at the company's send hour, remind everyone with
 *     missing days in the pay period that just ended — once a day, until
 *     the days are filled, the period is approved, or the company cap is
 *     reached — and email managers one summary.
 *   - `sendMissingTimeReminders`: a manager picks employees for the
 *     current or previous period and sends now.
 *
 * Reminders never change time entries; they only point the employee at
 * their timesheet.
 */
import type {
  MissingTimeEmployee,
  MissingTimePeriod,
  MissingTimeReport,
  MissingTimeSkipReason,
  PayPeriodType,
  SendMissingTimeRemindersResponse,
} from '@vibept/shared';
import { addDaysInTz, dayOfWeekInTz, isoDateInTz, resolvePayPeriod } from '@vibept/shared';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';
import { publicUrl } from './notifications/public-link.js';
import { notify } from './notifications/service.js';

// ---------------------------------------------------------------------------
// Company context
// ---------------------------------------------------------------------------

interface CompanyCtx {
  id: number;
  name: string;
  timezone: string;
  payPeriodType: PayPeriodType;
  weekStartDay: number;
  payPeriodAnchor: Date | null;
  workDays: number[];
  personalDeviceEnabled: boolean;
  employeeSelfEntry: boolean;
  remindersEnabled: boolean;
  reminderHour: number;
  reminderMax: number;
  supervisorApprovalRequired: boolean;
}

async function loadCompanyCtx(companyId: number): Promise<CompanyCtx> {
  const row = await db('companies as c')
    .join('company_settings as s', 's.company_id', 'c.id')
    .where('c.id', companyId)
    .first<{
      id: number;
      name: string;
      timezone: string;
      pay_period_type: PayPeriodType;
      week_start_day: number;
      pay_period_anchor: Date | null;
      work_days: number[];
      personal_device_enabled: boolean;
      employee_manual_entry_mode: 'allowed' | 'override_only' | 'disabled';
      missing_time_reminders_enabled: boolean;
      missing_time_reminder_hour: number;
      missing_time_reminder_max: number;
      supervisor_approval_required: boolean;
    }>('c.id', 'c.name', 'c.timezone', 'c.pay_period_type', 'c.week_start_day', 'c.pay_period_anchor', 's.work_days', 's.personal_device_enabled', 's.employee_manual_entry_mode', 's.missing_time_reminders_enabled', 's.missing_time_reminder_hour', 's.missing_time_reminder_max', 's.supervisor_approval_required');
  if (!row) throw NotFound('Company not found');
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    payPeriodType: row.pay_period_type,
    weekStartDay: row.week_start_day,
    payPeriodAnchor: row.pay_period_anchor,
    workDays: row.work_days,
    personalDeviceEnabled: row.personal_device_enabled,
    // A missing day has no punch to override, so only `allowed` lets an
    // employee fill it in directly; otherwise they ask through a
    // correction request.
    employeeSelfEntry: row.employee_manual_entry_mode === 'allowed',
    remindersEnabled: row.missing_time_reminders_enabled,
    reminderHour: row.missing_time_reminder_hour,
    reminderMax: row.missing_time_reminder_max,
    supervisorApprovalRequired: row.supervisor_approval_required,
  };
}

// ---------------------------------------------------------------------------
// Period + day helpers
// ---------------------------------------------------------------------------

interface PeriodWindow {
  which: MissingTimePeriod;
  /** UTC instants, [start, end). */
  start: Date;
  end: Date;
  /** Company-local calendar days, both inclusive. */
  startIso: string;
  endIso: string;
  /** Every day of the period, company-local. */
  days: Array<{ iso: string; dow: number }>;
}

export function periodWindow(
  ctx: Pick<CompanyCtx, 'timezone' | 'payPeriodType' | 'weekStartDay' | 'payPeriodAnchor'>,
  which: MissingTimePeriod,
  now: Date,
): PeriodWindow {
  const opts = {
    type: ctx.payPeriodType,
    weekStartDay: ctx.weekStartDay,
    ...(ctx.payPeriodAnchor ? { anchorDate: ctx.payPeriodAnchor } : {}),
    timezone: ctx.timezone,
  };
  const current = resolvePayPeriod(now, opts);
  const period =
    which === 'current' ? current : resolvePayPeriod(new Date(current.start.getTime() - 1), opts);
  const days: PeriodWindow['days'] = [];
  for (let d = period.start; d < period.end; d = addDaysInTz(d, 1, ctx.timezone)) {
    days.push({ iso: isoDateInTz(d, ctx.timezone), dow: dayOfWeekInTz(d, ctx.timezone) });
  }
  return {
    which,
    start: period.start,
    end: period.end,
    startIso: days[0]!.iso,
    endIso: days[days.length - 1]!.iso,
    days,
  };
}

/** Company-local hour of `now`, 0–23. */
function hourInTz(now: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now);
  return Number(h) % 24;
}

/** "Mon, Oct 20" for a YYYY-MM-DD calendar day. */
function dayLabel(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function periodLabel(p: Pick<PeriodWindow, 'startIso' | 'endIso'>): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return `${fmt(p.startIso)} – ${fmt(p.endIso)}`;
}

// ---------------------------------------------------------------------------
// Finding missing days
// ---------------------------------------------------------------------------

interface EmployeeRow {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  email_notifications_enabled: boolean;
  sms_notifications_enabled: boolean;
  phone_verified_at: Date | null;
  user_id: number | null;
  login_disabled_at: Date | null;
  hired_on: string | null;
  work_days: number[] | null;
  missing_time_reminders_enabled: boolean;
}

interface MissingRow extends MissingTimeEmployee {
  /** Automatic reminders already sent this period (the cap counts these). */
  autoSent: number;
  contact: EmployeeRow;
}

interface Computed {
  period: PeriodWindow;
  checkedThrough: string | null;
  rows: MissingRow[];
}

/**
 * Pure: which of `days` are missing for one employee. Exported for unit
 * tests; `computeMissingTime` is the DB-backed caller.
 */
export function missingDaysFor(input: {
  days: Array<{ iso: string; dow: number }>;
  todayIso: string;
  workDays: number[];
  hiredOn: string | null;
  coveredDays: Set<string>;
}): string[] {
  const expected = new Set(input.workDays);
  return input.days
    .filter(
      (d) =>
        d.iso < input.todayIso &&
        expected.has(d.dow) &&
        (!input.hiredOn || d.iso >= input.hiredOn) &&
        !input.coveredDays.has(d.iso),
    )
    .map((d) => d.iso);
}

async function computeMissingTime(
  ctx: CompanyCtx,
  which: MissingTimePeriod,
  now: Date,
  employeeIds?: number[],
): Promise<Computed> {
  const period = periodWindow(ctx, which, now);
  const todayIso = isoDateInTz(now, ctx.timezone);
  const past = period.days.filter((d) => d.iso < todayIso);
  const checkedThrough = past.length > 0 ? past[past.length - 1]!.iso : null;

  const employeesQ = db('employees')
    .where({ company_id: ctx.id, status: 'active' })
    .orderBy(['last_name', 'first_name'])
    .select<
      EmployeeRow[]
    >('id', 'first_name', 'last_name', 'email', 'phone', 'email_notifications_enabled', 'sms_notifications_enabled', 'phone_verified_at', 'user_id', 'login_disabled_at', db.raw(`to_char(hired_at, 'YYYY-MM-DD') as hired_on`), 'work_days', 'missing_time_reminders_enabled');
  if (employeeIds) employeesQ.whereIn('id', employeeIds);
  const employees = await employeesQ;
  if (employees.length === 0 || !checkedThrough) {
    return { period, checkedThrough, rows: [] };
  }
  const ids = employees.map((e) => e.id);

  // Active (not deleted, not superseded) entries that started in the
  // period. Work entries include time off, which is a job flag.
  const entries = await db('time_entries')
    .where({ company_id: ctx.id })
    .whereIn('employee_id', ids)
    .whereNull('deleted_at')
    .whereNull('superseded_by_entry_id')
    .where('started_at', '>=', period.start)
    .where('started_at', '<', period.end)
    .select<
      Array<{
        employee_id: number;
        started_at: Date;
        ended_at: Date | null;
        entry_type: 'work' | 'break';
        approved_at: Date | null;
      }>
    >('employee_id', 'started_at', 'ended_at', 'entry_type', 'approved_at');

  const covered = new Map<number, Set<string>>();
  const entryStats = new Map<number, { total: number; approved: number }>();
  for (const e of entries) {
    const stats = entryStats.get(e.employee_id) ?? { total: 0, approved: 0 };
    stats.total += 1;
    if (e.approved_at && e.ended_at) stats.approved += 1;
    entryStats.set(e.employee_id, stats);
    if (e.entry_type !== 'work') continue;
    const set = covered.get(e.employee_id) ?? new Set<string>();
    set.add(isoDateInTz(e.started_at, ctx.timezone));
    covered.set(e.employee_id, set);
  }

  const sentRows = await db('missing_time_reminders')
    .where({ company_id: ctx.id, kind: 'employee', period_start: period.startIso })
    .whereIn('employee_id', ids)
    .groupBy('employee_id')
    .select<
      Array<{ employee_id: number; total: number; auto: number; last_sent: Date | null }>
    >('employee_id', db.raw('count(*)::int as total'), db.raw(`count(*) filter (where trigger = 'auto')::int as auto`), db.raw('max(sent_at) as last_sent'));
  const sent = new Map(sentRows.map((r) => [r.employee_id, r]));

  const rows: MissingRow[] = [];
  for (const emp of employees) {
    const missingDates = missingDaysFor({
      days: period.days,
      todayIso,
      workDays: emp.work_days ?? ctx.workDays,
      hiredOn: emp.hired_on,
      coveredDays: covered.get(emp.id) ?? new Set(),
    });
    if (missingDates.length === 0) continue;

    const stats = entryStats.get(emp.id);
    const approved = !!stats && stats.total > 0 && stats.approved === stats.total;
    const canSignIn = ctx.personalDeviceEnabled && emp.user_id !== null && !emp.login_disabled_at;
    const reachable =
      (!!emp.email && emp.email_notifications_enabled) ||
      (!!emp.phone && emp.sms_notifications_enabled && !!emp.phone_verified_at);
    const skipReason: MissingTimeSkipReason | null = approved
      ? 'approved'
      : !emp.missing_time_reminders_enabled
        ? 'opted_out'
        : !canSignIn
          ? 'kiosk_only'
          : !reachable
            ? 'no_contact'
            : null;

    const s = sent.get(emp.id);
    rows.push({
      employeeId: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      missingDates,
      skipReason,
      remindersSent: s?.total ?? 0,
      lastRemindedAt: s?.last_sent ? new Date(s.last_sent).toISOString() : null,
      autoSent: s?.auto ?? 0,
      contact: emp,
    });
  }
  return { period, checkedThrough, rows };
}

export async function getMissingTimeReport(
  companyId: number,
  which: MissingTimePeriod,
  now: Date = new Date(),
): Promise<MissingTimeReport> {
  const ctx = await loadCompanyCtx(companyId);
  const { period, checkedThrough, rows } = await computeMissingTime(ctx, which, now);
  return {
    period: { which, start: period.startIso, end: period.endIso },
    checkedThrough,
    employees: rows.map(({ autoSent: _a, contact: _c, ...pub }) => pub),
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function remindEmployee(
  ctx: CompanyCtx,
  period: PeriodWindow,
  row: MissingRow,
): Promise<void> {
  const e = row.contact;
  await notify({
    companyId: ctx.id,
    type: 'missing_time_reminder',
    recipient: {
      kind: 'employee',
      id: e.id,
      email: e.email,
      phone: e.phone,
      emailOptIn: e.email_notifications_enabled,
      smsOptIn: e.sms_notifications_enabled,
      phoneVerified: !!e.phone_verified_at,
    },
    vars: {
      firstName: e.first_name,
      companyName: ctx.name,
      periodLabel: periodLabel(period),
      missingCount: row.missingDates.length,
      missingDays: row.missingDates.map(dayLabel).join('\n'),
      fixHow: ctx.employeeSelfEntry
        ? 'Please sign in and add the missing time on your timesheet.'
        : 'Please sign in, open your timesheet and use Add time to send the missing hours to your supervisor.',
      timesheetUrl: publicUrl('/my-timesheet'),
    },
  });
}

/** Manager-triggered send for chosen employees. */
export async function sendMissingTimeReminders(
  companyId: number,
  actorUserId: number,
  which: MissingTimePeriod,
  employeeIds: number[],
  now: Date = new Date(),
): Promise<SendMissingTimeRemindersResponse> {
  const ctx = await loadCompanyCtx(companyId);
  const { period, rows } = await computeMissingTime(ctx, which, now, employeeIds);
  const byId = new Map(rows.map((r) => [r.employeeId, r]));
  const localDate = isoDateInTz(now, ctx.timezone);

  const result: SendMissingTimeRemindersResponse = { sent: 0, skipped: [] };
  for (const employeeId of [...new Set(employeeIds)]) {
    const row = byId.get(employeeId);
    if (!row) {
      // Not in this company, not active, or nothing missing.
      result.skipped.push({ employeeId, reason: 'no_missing_days' });
      continue;
    }
    if (row.skipReason) {
      result.skipped.push({ employeeId, reason: row.skipReason });
      continue;
    }
    await db('missing_time_reminders').insert({
      company_id: ctx.id,
      employee_id: employeeId,
      kind: 'employee',
      trigger: 'manual',
      period_start: period.startIso,
      period_end: period.endIso,
      local_date: localDate,
      missing_dates: JSON.stringify(row.missingDates),
      sent_by: actorUserId,
    });
    await remindEmployee(ctx, period, row);
    result.sent += 1;
  }
  return result;
}

/** Company admins, plus supervisors when the company requires
 *  supervisor approval — anyone who can sign in to the company. */
async function summaryRecipients(ctx: CompanyCtx): Promise<Array<{ id: number; email: string }>> {
  const roles = ctx.supervisorApprovalRequired
    ? ['company_admin', 'supervisor']
    : ['company_admin'];
  return db('company_memberships as cm')
    .join('users as u', 'u.id', 'cm.user_id')
    .leftJoin('employees as e', function () {
      this.on('e.user_id', '=', 'cm.user_id').andOn('e.company_id', '=', 'cm.company_id');
    })
    .where('cm.company_id', ctx.id)
    .whereIn('cm.role', roles)
    .whereNull('u.disabled_at')
    .whereNull('e.login_disabled_at')
    .distinct<Array<{ id: number; email: string }>>('u.id', 'u.email');
}

async function sweepCompany(ctx: CompanyCtx, now: Date): Promise<number> {
  const localDate = isoDateInTz(now, ctx.timezone);
  const { period, rows } = await computeMissingTime(ctx, 'previous', now);
  const due = rows.filter((r) => !r.skipReason && r.autoSent < ctx.reminderMax);

  const reminded: MissingRow[] = [];
  for (const row of due) {
    // Claim today's slot first: the unique index makes a second run in
    // the same day (two workers, a retried job) a no-op.
    const claimed = await db('missing_time_reminders')
      .insert({
        company_id: ctx.id,
        employee_id: row.employeeId,
        kind: 'employee',
        trigger: 'auto',
        period_start: period.startIso,
        period_end: period.endIso,
        local_date: localDate,
        missing_dates: JSON.stringify(row.missingDates),
      })
      .onConflict(
        db.raw(
          `(company_id, COALESCE(employee_id, 0), kind, period_start, local_date) WHERE trigger = 'auto'`,
        ),
      )
      .ignore()
      .returning('id');
    if (claimed.length === 0) continue;
    try {
      await remindEmployee(ctx, period, row);
      reminded.push(row);
    } catch (err) {
      logger.error({ err, employeeId: row.employeeId }, 'missing-time reminder failed');
    }
  }

  if (reminded.length > 0) {
    const claimed = await db('missing_time_reminders')
      .insert({
        company_id: ctx.id,
        employee_id: null,
        kind: 'summary',
        trigger: 'auto',
        period_start: period.startIso,
        period_end: period.endIso,
        local_date: localDate,
        missing_dates: JSON.stringify([]),
      })
      .onConflict(
        db.raw(
          `(company_id, COALESCE(employee_id, 0), kind, period_start, local_date) WHERE trigger = 'auto'`,
        ),
      )
      .ignore()
      .returning('id');
    if (claimed.length > 0) {
      const summaryList = reminded
        .map(
          (r) =>
            `${r.firstName} ${r.lastName}: ${r.missingDates.length} day(s) (${r.missingDates.map(dayLabel).join(', ')})`,
        )
        .join('\n');
      for (const user of await summaryRecipients(ctx)) {
        try {
          await notify({
            companyId: ctx.id,
            type: 'missing_time_summary',
            recipient: { kind: 'user', id: user.id, email: user.email, companyScoped: true },
            channels: ['email'],
            vars: {
              companyName: ctx.name,
              periodLabel: periodLabel(period),
              employeeCount: reminded.length,
              summaryList,
              reviewUrl: publicUrl(`/companies/${ctx.id}/timesheets`),
            },
          });
        } catch (err) {
          logger.error({ err, userId: user.id }, 'missing-time summary failed');
        }
      }
    }
  }
  return reminded.length;
}

/**
 * Hourly job. Each company with reminders on is handled once a day, in
 * the hour its admins chose (company time), for the pay period that
 * ended most recently.
 */
export async function runMissingTimeSweep(now: Date = new Date()): Promise<number> {
  const start = Date.now();
  const companies = await db('company_settings')
    .where({ missing_time_reminders_enabled: true })
    .pluck<number[]>('company_id');

  let sent = 0;
  for (const companyId of companies) {
    try {
      const ctx = await loadCompanyCtx(companyId);
      if (hourInTz(now, ctx.timezone) !== ctx.reminderHour) continue;
      sent += await sweepCompany(ctx, now);
    } catch (err) {
      logger.error({ err, companyId }, 'missing-time sweep failed for company');
    }
  }
  logger.info(
    { companies: companies.length, sent, elapsed: Date.now() - start },
    'missing-time sweep complete',
  );
  return sent;
}
