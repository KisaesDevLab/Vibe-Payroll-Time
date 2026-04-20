import type { RoundingMode } from '../enums.js';

const INTERVAL_MINUTES: Record<Exclude<RoundingMode, 'none'>, number> = {
  '1min': 1,
  '5min': 5,
  '6min': 6,
  '15min': 15,
};

export interface RoundOptions {
  mode: RoundingMode;
  /** Minutes of "grace" around each rounding boundary. Inside the grace
   *  window we snap to the boundary; outside we leave the timestamp
   *  alone. A grace of 0 with a non-`none` mode means "always round to
   *  the nearest boundary", matching the common 7-minute rule when
   *  combined with 15-min rounding. */
  graceMinutes: number;
  /** Breaks ties on exact midpoints. `in` → round up; `out` → round down. */
  direction: 'in' | 'out';
}

/**
 * Round a timestamp according to the company's punch-rounding policy.
 * The raw punch is never mutated; this is only applied at display/report
 * time. See CLAUDE.md Conventions → Rounding.
 */
export function roundTimestamp(ts: Date, opts: RoundOptions): Date {
  if (opts.mode === 'none') return ts;

  const intervalMs = INTERVAL_MINUTES[opts.mode] * 60_000;
  const ms = ts.getTime();
  const lower = Math.floor(ms / intervalMs) * intervalMs;
  const upper = lower + intervalMs;
  const distLower = ms - lower;
  const distUpper = upper - ms;
  const distNearest = Math.min(distLower, distUpper);

  // Grace gate: if the grace window is narrower than "nearest boundary
  // distance", we're in the dead zone and leave the timestamp alone.
  // A grace of 0 short-circuits the gate entirely (always round).
  if (opts.graceMinutes > 0 && distNearest > opts.graceMinutes * 60_000) {
    return ts;
  }

  if (distLower === distUpper) {
    return new Date(opts.direction === 'in' ? upper : lower);
  }
  return new Date(distLower < distUpper ? lower : upper);
}

/**
 * Rounded duration in seconds between `start` and `end`, with the start
 * rounded as a clock-in and the end rounded as a clock-out.
 */
export function roundedDurationSeconds(
  start: Date,
  end: Date,
  opts: Omit<RoundOptions, 'direction'>,
): number {
  const rs = roundTimestamp(start, { ...opts, direction: 'in' });
  const re = roundTimestamp(end, { ...opts, direction: 'out' });
  return Math.max(0, Math.floor((re.getTime() - rs.getTime()) / 1000));
}
