import type {
  MultiEmployeeGridResponse,
  PayPeriodType,
  PunchSource,
  TimeFormat,
  WeeklyGridCell,
  WeeklyGridResponse,
} from '@vibept/shared';
import {
  addDaysInTz,
  buildTimesheetSummary,
  isoDateInTz,
  resolveFormat,
  resolvePayPeriod,
  startOfDayInTz,
} from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from './punch.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface CompanyContext {
  id: number;
  timezone: string;
  weekStartDay: number;
  payPeriodType: PayPeriodType;
  payPeriodAnchor: Date | null;
  timeFormatDefault: TimeFormat;
  roundingMode: 'none' | '1min' | '5min' | '6min' | '15min';
  roundingGraceMinutes: number;
}

async function loadCompany(companyId: number): Promise<CompanyContext> {
  const row = await db('companies as c')
    .leftJoin('company_settings as s', 's.company_id', 'c.id')
    .where('c.id', companyId)
    .first<{
      id: number;
      timezone: string;
      week_start_day: number;
      pay_period_type: PayPeriodType;
      pay_period_anchor: Date | null;
      time_format_default: TimeFormat;
      punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
      punch_rounding_grace_minutes: number;
    }>('c.id', 'c.timezone', 'c.week_start_day', 'c.pay_period_type', 'c.pay_period_anchor', 's.time_format_default', 's.punch_rounding_mode', 's.punch_rounding_grace_minutes');
  if (!row) throw NotFound('Company not found');
  return {
    id: row.id,
    timezone: row.timezone,
    weekStartDay: row.week_start_day,
    payPeriodType: row.pay_period_type,
    payPeriodAnchor: row.pay_period_anchor,
    timeFormatDefault: row.time_format_default ?? 'decimal',
    roundingMode: row.punch_rounding_mode,
    roundingGraceMinutes: row.punch_rounding_grace_minutes,
  };
}

async function resolveUserTimeFormat(
  actorUserId: number,
  companyDefault: TimeFormat,
): Promise<TimeFormat> {
  const row = await db('users').where({ id: actorUserId }).first<{
    time_format_preference: TimeFormat | null;
  }>();
  return resolveFormat(row?.time_format_preference ?? null, companyDefault);
}

/** Parse `YYYY-MM-DD` → UTC instant of local-midnight-in-tz. */
function dayToUtcMidnight(isoDay: string, tz: string): Date {
  // Build a Date by parsing as local noon, then slide to startOfDayInTz
  // — avoids TZ-math pitfalls when the naive parse lands near DST.
  const parts = isoDay.split('-').map(Number);
  const guess = new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, 12, 0, 0));
  return startOfDayInTz(guess, tz);
}

// ---------------------------------------------------------------------------
// Weekly grid (single employee)
// ---------------------------------------------------------------------------

export interface GetWeeklyGridInput {
  companyId: number;
  employeeId: number;
  /** ISO YYYY-MM-DD of the week's Sunday/Monday (per company weekStartDay). */
  weekStart: string;
  actorUserId: number;
}

export async function getWeeklyGrid(input: GetWeeklyGridInput): Promise<WeeklyGridResponse> {
  const company = await loadCompany(input.companyId);

  const employee = await db('employees')
    .where({ id: input.employeeId, company_id: input.companyId })
    .first<{ id: number; first_name: string; last_name: string }>();
  if (!employee) throw NotFound('Employee not found');

  const weekStartUtc = dayToUtcMidnight(input.weekStart, company.timezone);
  const weekEndUtc = addDaysInTz(weekStartUtc, 7, company.timezone);
  const weekEndIso = isoDateInTz(addDaysInTz(weekStartUtc, 6, company.timezone), company.timezone);

  // All active jobs for the company; the grid shows every job as a row
  // so users can add entries on jobs that haven't been touched this
  // week yet.
  const jobs = await db('jobs')
    .where({ company_id: input.companyId })
    .whereNull('archived_at')
    .orderBy('code', 'asc')
    .select<
      Array<{ id: number; code: string; name: string; archived_at: Date | null }>
    >('id', 'code', 'name', 'archived_at');

  // All non-superseded, non-deleted entries that overlap the 7-day window.
  const rows = await db<TimeEntryRow>('time_entries')
    .where({ company_id: input.companyId, employee_id: input.employeeId })
    .whereNull('deleted_at')
    .whereNull('superseded_by_entry_id')
    .where('started_at', '<', weekEndUtc)
    .where(function () {
      this.whereNull('ended_at').orWhere('ended_at', '>', weekStartUtc);
    })
    .orderBy('started_at', 'asc');

  const entries = rows.map(rowToTimeEntry);

  // Bucket entries into (jobKey, date) cells. Each cell tallies seconds
  // from all contributing entries; sourceTag is the "highest-priority"
  // source we saw.
  type CellKey = string; // `${jobIdOrNull}|${YYYY-MM-DD}`
  interface CellAgg {
    jobId: number | null;
    date: string;
    seconds: number;
    hadPunch: boolean;
    hadManual: boolean;
    manualEntryId: number | null;
    manualReason: string | null;
  }
  const cellAggs = new Map<CellKey, CellAgg>();
  function cellKey(jobId: number | null, date: string): CellKey {
    return `${jobId ?? '_'}|${date}`;
  }

  // Pre-seed every (job × day) so even empty cells come back — the UI
  // needs them as click targets.
  const dayIsos: string[] = [];
  for (let d = 0; d < 7; d++) {
    const iso = isoDateInTz(addDaysInTz(weekStartUtc, d, company.timezone), company.timezone);
    dayIsos.push(iso);
  }
  // Include "no job" as a row — pure manual work with a null job_id.
  const jobKeys: Array<number | null> = [...jobs.map((j) => j.id), null];
  for (const jk of jobKeys) {
    for (const iso of dayIsos) {
      cellAggs.set(cellKey(jk, iso), {
        jobId: jk,
        date: iso,
        seconds: 0,
        hadPunch: false,
        hadManual: false,
        manualEntryId: null,
        manualReason: null,
      });
    }
  }

  const now = new Date();
  for (const e of entries) {
    if (e.entryType !== 'work') continue; // breaks don't show in the grid
    const startedAt = new Date(e.startedAt);
    const endedAt = e.endedAt ? new Date(e.endedAt) : now;
    // Split across day boundaries in company tz.
    let cursor = startedAt;
    while (cursor < endedAt) {
      const iso = isoDateInTz(cursor, company.timezone);
      const nextMidnight = addDaysInTz(
        startOfDayInTz(cursor, company.timezone),
        1,
        company.timezone,
      );
      const sliceEnd = endedAt < nextMidnight ? endedAt : nextMidnight;
      const seconds = Math.max(0, Math.floor((sliceEnd.getTime() - cursor.getTime()) / 1000));
      const key = cellKey(e.jobId, iso);
      const agg = cellAggs.get(key);
      if (agg) {
        agg.seconds += seconds;
        if (e.source === 'web_manual') {
          agg.hadManual = true;
          agg.manualEntryId = e.id;
          agg.manualReason = e.entryReason;
        } else {
          agg.hadPunch = true;
        }
      }
      cursor = sliceEnd;
    }
  }

  const cells: WeeklyGridCell[] = [];
  const dayTotals = new Map<string, number>();
  const jobTotals = new Map<number | null, number>();

  for (const agg of cellAggs.values()) {
    const sourceTag: WeeklyGridCell['sourceTag'] =
      agg.seconds === 0
        ? 'none'
        : agg.hadManual && agg.hadPunch
          ? 'mixed'
          : agg.hadManual
            ? 'manual'
            : 'punched';
    cells.push({
      jobId: agg.jobId,
      date: agg.date,
      seconds: agg.seconds,
      sourceTag,
      manualEntryId: agg.manualEntryId,
      entryReason: agg.manualReason,
      locked: false, // filled in below once we know approval state
    });
    dayTotals.set(agg.date, (dayTotals.get(agg.date) ?? 0) + agg.seconds);
    jobTotals.set(agg.jobId, (jobTotals.get(agg.jobId) ?? 0) + agg.seconds);
  }

  // Lock state: any entry in the day is approved → the cell is locked.
  const approvedDays = new Set<string>();
  for (const e of entries) {
    if (e.approvedAt) {
      approvedDays.add(isoDateInTz(new Date(e.startedAt), company.timezone));
    }
  }
  for (const c of cells) {
    if (approvedDays.has(c.date)) c.locked = true;
  }

  // Day summary — hasException flag (open entries, auto-closed, etc.)
  // and hasManual. Week-row total too.
  const daySummaries = dayIsos.map((iso) => {
    let hasException = false;
    let hasManual = false;
    for (const e of entries) {
      if (isoDateInTz(new Date(e.startedAt), company.timezone) !== iso) continue;
      if (!e.endedAt || e.isAutoClosed) hasException = true;
      if (e.source === 'web_manual') hasManual = true;
    }
    return {
      date: iso,
      totalSeconds: dayTotals.get(iso) ?? 0,
      hasException,
      hasManual,
    };
  });

  const weekTotal = Array.from(dayTotals.values()).reduce((s, v) => s + v, 0);
  const allApproved = entries.length > 0 && entries.every((e) => !!e.approvedAt && !!e.endedAt);
  const timeFormat = await resolveUserTimeFormat(input.actorUserId, company.timeFormatDefault);

  return {
    employee: {
      id: employee.id,
      firstName: employee.first_name,
      lastName: employee.last_name,
      companyId: input.companyId,
    },
    week: { start: input.weekStart, end: weekEndIso },
    jobs: jobs.map((j) => ({
      id: j.id,
      code: j.code,
      name: j.name,
      archivedAt: j.archived_at?.toISOString() ?? null,
    })),
    days: daySummaries,
    cells,
    jobTotals: Array.from(jobTotals.entries()).map(([jobId, seconds]) => ({
      jobId,
      seconds,
    })),
    entries,
    weekTotalSeconds: weekTotal,
    allApproved,
    timeFormat,
  };
}

// ---------------------------------------------------------------------------
// Multi-employee grid
// ---------------------------------------------------------------------------

export interface GetMultiEmployeeGridInput {
  companyId: number;
  weekStart: string;
  /** Optional filter. When omitted, all active employees are returned. */
  employeeIds?: number[];
  actorUserId: number;
}

export async function getMultiEmployeeGrid(
  input: GetMultiEmployeeGridInput,
): Promise<MultiEmployeeGridResponse> {
  const company = await loadCompany(input.companyId);
  const weekStartUtc = dayToUtcMidnight(input.weekStart, company.timezone);
  const weekEndUtc = addDaysInTz(weekStartUtc, 7, company.timezone);
  const weekEndIso = isoDateInTz(addDaysInTz(weekStartUtc, 6, company.timezone), company.timezone);

  const empQ = db('employees')
    .where({ company_id: input.companyId, status: 'active' })
    .orderBy(['last_name', 'first_name']);
  if (input.employeeIds?.length) {
    empQ.whereIn('id', input.employeeIds);
  }
  const employees = await empQ.select<Array<{ id: number; first_name: string; last_name: string }>>(
    'id',
    'first_name',
    'last_name',
  );
  if (employees.length === 0) {
    const timeFormat = await resolveUserTimeFormat(input.actorUserId, company.timeFormatDefault);
    return {
      companyId: input.companyId,
      week: { start: input.weekStart, end: weekEndIso },
      rows: [],
      dailyTotals: buildEmptyDailyTotals(weekStartUtc, company.timezone),
      grandTotalSeconds: 0,
      stats: {
        employeeCount: 0,
        regularSeconds: 0,
        overtimeSeconds: 0,
        cellsNeedingReview: 0,
      },
      timeFormat,
    };
  }

  const empIds = employees.map((e) => e.id);
  const rows = await db<TimeEntryRow>('time_entries')
    .where('company_id', input.companyId)
    .whereIn('employee_id', empIds)
    .whereNull('deleted_at')
    .whereNull('superseded_by_entry_id')
    .where('started_at', '<', weekEndUtc)
    .where(function () {
      this.whereNull('ended_at').orWhere('ended_at', '>', weekStartUtc);
    })
    .orderBy('started_at', 'asc');

  const byEmp = new Map<number, TimeEntryRow[]>();
  for (const r of rows) {
    const list = byEmp.get(r.employee_id);
    if (list) list.push(r);
    else byEmp.set(r.employee_id, [r]);
  }

  // Use the existing summary builder per employee so OT math matches
  // the rest of the app exactly.
  const resp: MultiEmployeeGridResponse = {
    companyId: input.companyId,
    week: { start: input.weekStart, end: weekEndIso },
    rows: [],
    dailyTotals: buildEmptyDailyTotals(weekStartUtc, company.timezone),
    grandTotalSeconds: 0,
    stats: {
      employeeCount: employees.length,
      regularSeconds: 0,
      overtimeSeconds: 0,
      cellsNeedingReview: 0,
    },
    timeFormat: await resolveUserTimeFormat(input.actorUserId, company.timeFormatDefault),
  };

  const dayIsos = resp.dailyTotals.map((d) => d.date);
  const dayTotalsByDate = new Map(resp.dailyTotals.map((d) => [d.date, 0]));

  for (const emp of employees) {
    const entries = byEmp.get(emp.id) ?? [];
    const summary = buildTimesheetSummary(
      entries.map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        shiftId: r.shift_id,
        entryType: r.entry_type,
        jobId: r.job_id,
        startedAt: r.started_at,
        endedAt: r.ended_at,
      })),
      {
        timezone: company.timezone,
        weekStartDay: company.weekStartDay,
        roundingMode: company.roundingMode,
        roundingGraceMinutes: company.roundingGraceMinutes,
        periodStart: weekStartUtc,
        periodEnd: weekEndUtc,
      },
    );

    const daysByIso = new Map(summary.days.map((d) => [d.date, d]));
    const daysOut = dayIsos.map((iso) => {
      const d = daysByIso.get(iso);
      const seconds = d?.workSeconds ?? 0;
      const dayEntries = entries.filter(
        (r) => (d?.entryIds.includes(r.id) ?? false) || (!d && false),
      );
      const hasException = dayEntries.some((r) => !r.ended_at || r.is_auto_closed);
      const hasManual = dayEntries.some((r) => r.source === ('web_manual' satisfies PunchSource));
      return {
        date: iso,
        seconds,
        hasException,
        hasManual,
        contributesToOT: false, // set below
      };
    });

    const weekSeconds = summary.periodTotal.workSeconds;
    const regular = summary.periodTotal.regularSeconds;
    const ot = summary.periodTotal.overtimeSeconds;

    // Mark days that contribute to OT. Simple heuristic: if the week
    // has OT, paint any day whose seconds > avg-non-OT-day as OT. Good
    // enough for the UI hint.
    if (ot > 0) {
      const sorted = [...daysOut].sort((a, b) => b.seconds - a.seconds);
      let remaining = ot;
      for (const d of sorted) {
        if (remaining <= 0) break;
        if (d.seconds <= 0) continue;
        daysOut.find((x) => x.date === d.date)!.contributesToOT = true;
        remaining -= Math.min(d.seconds, remaining);
      }
    }

    const allApproved = entries.length > 0 && entries.every((r) => !!r.approved_at && !!r.ended_at);
    const hasPending = entries.some((r) => !r.ended_at || r.is_auto_closed);
    resp.rows.push({
      id: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      days: daysOut,
      weekSeconds,
      regularSeconds: regular,
      overtimeSeconds: ot,
      allApproved,
      hasPending,
    });

    for (const d of daysOut) {
      dayTotalsByDate.set(d.date, (dayTotalsByDate.get(d.date) ?? 0) + d.seconds);
      if (d.hasException) resp.stats.cellsNeedingReview += 1;
    }
    resp.stats.regularSeconds += regular;
    resp.stats.overtimeSeconds += ot;
  }

  resp.dailyTotals = Array.from(dayTotalsByDate.entries()).map(([date, seconds]) => ({
    date,
    seconds,
  }));
  resp.grandTotalSeconds = resp.dailyTotals.reduce((s, d) => s + d.seconds, 0);

  return resp;
}

function buildEmptyDailyTotals(
  weekStartUtc: Date,
  tz: string,
): Array<{ date: string; seconds: number }> {
  const out: Array<{ date: string; seconds: number }> = [];
  for (let d = 0; d < 7; d++) {
    const iso = isoDateInTz(addDaysInTz(weekStartUtc, d, tz), tz);
    out.push({ date: iso, seconds: 0 });
  }
  return out;
}

// Re-export resolvePayPeriod so callers don't have to import shared
// directly.
export { resolvePayPeriod };
