import { addDaysInTz, dayOfWeekInTz, startOfDayInTz } from './tz.js';

export interface WorkWeek {
  /** Inclusive start, UTC. */
  start: Date;
  /** Exclusive end, UTC (start + 7 civil days). */
  end: Date;
}

/**
 * Resolve the 7-day FLSA work week that contains `date`, in the company's
 * timezone. Week starts on `weekStartDay` (0 = Sunday, 6 = Saturday).
 *
 * Independent of pay period — FLSA requires OT to be calculated on a
 * fixed 7-day period, not on pay period boundaries. A bi-weekly pay
 * period that crosses a week boundary still gets its OT split by week.
 */
export function resolveWorkWeek(
  date: Date,
  opts: { weekStartDay: number; timezone: string },
): WorkWeek {
  const dayOfWeek = dayOfWeekInTz(date, opts.timezone);
  const diff = (dayOfWeek - opts.weekStartDay + 7) % 7;
  const start = addDaysInTz(startOfDayInTz(date, opts.timezone), -diff, opts.timezone);
  const end = addDaysInTz(start, 7, opts.timezone);
  return { start, end };
}
