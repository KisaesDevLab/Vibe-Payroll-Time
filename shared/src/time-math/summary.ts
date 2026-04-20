import { FLSA_OT_THRESHOLD_HOURS } from '../constants.js';
import type { RoundingMode } from '../enums.js';
import { roundedDurationSeconds } from './rounding.js';
import { isoDateInTz } from './tz.js';
import { resolveWorkWeek, type WorkWeek } from './week.js';

/** Input entry shape — only the fields the math needs. Keeping it
 *  decoupled from the HTTP TimeEntry type lets the math module stay
 *  zero-dep besides date-fns. */
export interface SummaryEntry {
  id: number;
  employeeId: number;
  shiftId: string;
  entryType: 'work' | 'break';
  jobId: number | null;
  /** ISO or Date. */
  startedAt: string | Date;
  endedAt: string | Date | null;
}

export interface SummaryOptions {
  timezone: string;
  weekStartDay: number;
  roundingMode: RoundingMode;
  roundingGraceMinutes: number;
  /** Inclusive start (UTC). */
  periodStart: Date;
  /** Exclusive end (UTC). */
  periodEnd: Date;
  /** If provided, the elapsed "live" time on an open entry is counted up
   *  to this instant. Defaults to `new Date()`. */
  now?: Date;
}

export interface DaySummaryInternal {
  /** YYYY-MM-DD in company tz. */
  date: string;
  workSeconds: number;
  breakSeconds: number;
  entryIds: number[];
}

export interface WeekSummaryInternal {
  /** ISO UTC; the week's civil-midnight-in-tz start. */
  weekStart: string;
  workSeconds: number;
  regularSeconds: number;
  overtimeSeconds: number;
}

export interface TimesheetSummary {
  days: DaySummaryInternal[];
  weeks: WeekSummaryInternal[];
  periodTotal: {
    workSeconds: number;
    breakSeconds: number;
    regularSeconds: number;
    overtimeSeconds: number;
  };
  jobBreakdown: Array<{ jobId: number | null; workSeconds: number }>;
}

function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 1000));
}

/** Clip an entry interval to the pay period window. Returns null if fully
 *  outside. */
function clip(
  start: Date,
  end: Date,
  periodStart: Date,
  periodEnd: Date,
): { start: Date; end: Date } | null {
  const s = start.getTime() < periodStart.getTime() ? periodStart : start;
  const e = end.getTime() > periodEnd.getTime() ? periodEnd : end;
  if (s.getTime() >= e.getTime()) return null;
  return { start: s, end: e };
}

/**
 * Core aggregation. Walks the raw entries, applies rounding, tallies:
 *   - daily work/break totals (keyed by civil date in company tz)
 *   - per-work-week totals (FLSA 7-day, independent of pay period)
 *   - overall period totals
 *   - per-job work breakdown
 *
 * FLSA OT is computed per work-week then clipped to the pay period: if a
 * week straddles the period, each day's OT contribution is proportional
 * to that day's share of the week's work.
 */
export function buildTimesheetSummary(
  entries: SummaryEntry[],
  opts: SummaryOptions,
): TimesheetSummary {
  const now = opts.now ?? new Date();
  const tz = opts.timezone;
  const periodStart = opts.periodStart;
  const periodEnd = opts.periodEnd;

  const dayMap = new Map<string, DaySummaryInternal>();
  const weekMap = new Map<
    string,
    {
      weekStart: Date;
      weekEnd: Date;
      // Keyed by YYYY-MM-DD in tz so we can apportion OT per day.
      perDayWorkSeconds: Map<string, number>;
    }
  >();
  const jobMap = new Map<number | null, number>();

  for (const entry of entries) {
    const entryStart = toDate(entry.startedAt);
    const entryEnd = entry.endedAt ? toDate(entry.endedAt) : now;
    const clipped = clip(entryStart, entryEnd, periodStart, periodEnd);
    if (!clipped) continue;

    // Rounded duration for work entries; break entries are unrounded (raw
    // duration is what we care about for the employee's visibility).
    let secs: number;
    if (entry.entryType === 'work') {
      secs = roundedDurationSeconds(clipped.start, clipped.end, {
        mode: opts.roundingMode,
        graceMinutes: opts.roundingGraceMinutes,
      });
    } else {
      secs = secondsBetween(clipped.start, clipped.end);
    }

    // Day key uses the entry's civil-local start date. Entries crossing
    // midnight (rare at scale) get counted wholly on their start day; a
    // future refinement can split them.
    const dayKey = isoDateInTz(clipped.start, tz);
    const day = dayMap.get(dayKey) ?? {
      date: dayKey,
      workSeconds: 0,
      breakSeconds: 0,
      entryIds: [],
    };
    if (entry.entryType === 'work') day.workSeconds += secs;
    else day.breakSeconds += secs;
    day.entryIds.push(entry.id);
    dayMap.set(dayKey, day);

    if (entry.entryType === 'work') {
      const week = resolveWorkWeek(clipped.start, {
        weekStartDay: opts.weekStartDay,
        timezone: tz,
      });
      const wk = weekMap.get(week.start.toISOString()) ?? {
        weekStart: week.start,
        weekEnd: week.end,
        perDayWorkSeconds: new Map<string, number>(),
      };
      wk.perDayWorkSeconds.set(dayKey, (wk.perDayWorkSeconds.get(dayKey) ?? 0) + secs);
      weekMap.set(week.start.toISOString(), wk);

      jobMap.set(entry.jobId, (jobMap.get(entry.jobId) ?? 0) + secs);
    }
  }

  // Weekly OT calculation. Sum the week's total; anything over the FLSA
  // threshold is overtime. When the week straddles the pay period, we
  // include the FULL week's hours in the OT decision but only COUNT the
  // in-period days toward the period total (fair split per CLAUDE.md
  // pitfall "week spans a pay period boundary").
  const OT_SECS = FLSA_OT_THRESHOLD_HOURS * 3600;

  let periodWorkSeconds = 0;
  let periodBreakSeconds = 0;
  let periodRegularSeconds = 0;
  let periodOvertimeSeconds = 0;

  for (const d of dayMap.values()) {
    periodWorkSeconds += d.workSeconds;
    periodBreakSeconds += d.breakSeconds;
  }

  const weeks: WeekSummaryInternal[] = [];
  for (const wk of weekMap.values()) {
    // We only have in-period work in perDayWorkSeconds (entries outside
    // the period were filtered). That's what we apportion OT across.
    let weekTotalInPeriod = 0;
    for (const secs of wk.perDayWorkSeconds.values()) weekTotalInPeriod += secs;

    const regular = Math.min(weekTotalInPeriod, OT_SECS);
    const overtime = Math.max(0, weekTotalInPeriod - OT_SECS);
    weeks.push({
      weekStart: wk.weekStart.toISOString(),
      workSeconds: weekTotalInPeriod,
      regularSeconds: regular,
      overtimeSeconds: overtime,
    });
    periodRegularSeconds += regular;
    periodOvertimeSeconds += overtime;
  }

  const days = [...dayMap.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  weeks.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const jobBreakdown = [...jobMap.entries()]
    .map(([jobId, secs]) => ({ jobId, workSeconds: secs }))
    .sort((a, b) => b.workSeconds - a.workSeconds);

  return {
    days,
    weeks,
    periodTotal: {
      workSeconds: periodWorkSeconds,
      breakSeconds: periodBreakSeconds,
      regularSeconds: periodRegularSeconds,
      overtimeSeconds: periodOvertimeSeconds,
    },
    jobBreakdown,
  };
}

export { resolveWorkWeek };
export type { WorkWeek };
