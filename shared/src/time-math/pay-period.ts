import type { PayPeriodType } from '../enums.js';
import {
  addDaysInTz,
  addMonthsInTz,
  dayOfMonthInTz,
  dayOfWeekInTz,
  startOfDayInTz,
  startOfMonthInTz,
} from './tz.js';

export interface PayPeriod {
  /** Inclusive start, UTC. */
  start: Date;
  /** Exclusive end, UTC. */
  end: Date;
}

export interface PayPeriodOptions {
  type: PayPeriodType;
  /** 0 = Sunday .. 6 = Saturday. */
  weekStartDay: number;
  /** For `bi_weekly`: the anchor date (any date within a known pay period).
   *  Defaults to 1970-01-04 (a Sunday) if omitted and type=bi_weekly. */
  anchorDate?: Date | null;
  timezone: string;
}

/**
 * Resolve the pay period that contains `date`, in the company's timezone.
 * The returned {start, end} is a half-open interval [start, end).
 */
export function resolvePayPeriod(date: Date, opts: PayPeriodOptions): PayPeriod {
  switch (opts.type) {
    case 'weekly':
      return weekly(date, opts);
    case 'bi_weekly':
      return biWeekly(date, opts);
    case 'semi_monthly':
      return semiMonthly(date, opts);
    case 'monthly':
      return monthly(date, opts);
    default: {
      // Exhaustive check — if a new type is added the compiler flags it.
      const _exhaustive: never = opts.type;
      throw new Error(`Unknown pay period type: ${String(_exhaustive)}`);
    }
  }
}

function weekly(date: Date, opts: PayPeriodOptions): PayPeriod {
  const dow = dayOfWeekInTz(date, opts.timezone);
  const offset = (dow - opts.weekStartDay + 7) % 7;
  const start = addDaysInTz(startOfDayInTz(date, opts.timezone), -offset, opts.timezone);
  const end = addDaysInTz(start, 7, opts.timezone);
  return { start, end };
}

function biWeekly(date: Date, opts: PayPeriodOptions): PayPeriod {
  // Anchor default: 1970-01-04 (a Sunday), to make bi-weekly math
  // deterministic when no anchor is set yet. Callers with a configured
  // anchor pass it explicitly.
  const anchor =
    opts.anchorDate ?? new Date(Date.UTC(1970, 0, 4)); // Sun, 1970-01-04
  const anchorStart = weekly(anchor, opts).start;

  const periodDays = 14;
  const dayMs = 86_400_000;
  const target = startOfDayInTz(date, opts.timezone);

  // Number of civil days between target and anchorStart.
  const deltaDays = Math.floor((target.getTime() - anchorStart.getTime()) / dayMs);
  // Align to a 14-day boundary (floorDiv, correct for negative).
  const aligned = Math.floor(deltaDays / periodDays) * periodDays;

  const start = addDaysInTz(anchorStart, aligned, opts.timezone);
  const end = addDaysInTz(start, periodDays, opts.timezone);
  return { start, end };
}

function semiMonthly(date: Date, opts: PayPeriodOptions): PayPeriod {
  const day = dayOfMonthInTz(date, opts.timezone);
  const monthStart = startOfMonthInTz(date, opts.timezone);
  if (day <= 15) {
    const start = monthStart;
    const end = addDaysInTz(monthStart, 15, opts.timezone); // the 16th @ 00:00
    return { start, end };
  }
  const start = addDaysInTz(monthStart, 15, opts.timezone);
  const end = addMonthsInTz(monthStart, 1, opts.timezone);
  return { start, end };
}

function monthly(date: Date, opts: PayPeriodOptions): PayPeriod {
  const start = startOfMonthInTz(date, opts.timezone);
  const end = addMonthsInTz(start, 1, opts.timezone);
  return { start, end };
}
