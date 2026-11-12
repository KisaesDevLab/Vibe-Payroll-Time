// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Return the UTC Date representing the start of the day (00:00:00 local)
 * for the given UTC instant viewed in the given IANA timezone.
 *
 * Handles DST correctly — e.g. in America/Chicago on the Sunday of the
 * "spring forward" transition, startOfDayInTz returns the UTC instant
 * corresponding to the civil midnight before the clocks moved, not
 * 23:00 UTC — local-midnight is preserved, even if the day is only
 * 23 hours long.
 */
export function startOfDayInTz(date: Date, tz: string): Date {
  const zoned = toZonedTime(date, tz);
  zoned.setHours(0, 0, 0, 0);
  return fromZonedTime(zoned, tz);
}

export function addDaysInTz(date: Date, days: number, tz: string): Date {
  const zoned = toZonedTime(date, tz);
  zoned.setDate(zoned.getDate() + days);
  return fromZonedTime(zoned, tz);
}

export function addMonthsInTz(date: Date, months: number, tz: string): Date {
  const zoned = toZonedTime(date, tz);
  zoned.setMonth(zoned.getMonth() + months);
  return fromZonedTime(zoned, tz);
}

/** Start of the calendar month (day 1, 00:00 local) for `date` in `tz`. */
export function startOfMonthInTz(date: Date, tz: string): Date {
  const zoned = toZonedTime(date, tz);
  zoned.setDate(1);
  zoned.setHours(0, 0, 0, 0);
  return fromZonedTime(zoned, tz);
}

/** Civil day-of-month (1-based) of `date` in `tz`. */
export function dayOfMonthInTz(date: Date, tz: string): number {
  return toZonedTime(date, tz).getDate();
}

/** 0 = Sunday, 6 = Saturday — day of week of `date` in `tz`. */
export function dayOfWeekInTz(date: Date, tz: string): number {
  return toZonedTime(date, tz).getDay();
}

/** Days between civil-date(start) and civil-date(end) in tz. End is
 *  exclusive. Robust to DST changes by comparing local dates. */
export function civilDaysBetween(start: Date, end: Date, tz: string): number {
  const startMidnight = startOfDayInTz(start, tz);
  const endMidnight = startOfDayInTz(end, tz);
  // Add a half-day buffer to avoid DST-induced off-by-ones when rounding.
  return Math.round((endMidnight.getTime() - startMidnight.getTime()) / 86_400_000);
}

/** YYYY-MM-DD of `date` in `tz`. Useful for day grouping keys. */
export function isoDateInTz(date: Date, tz: string): string {
  const zoned = toZonedTime(date, tz);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, '0');
  const d = String(zoned.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's civil date (YYYY-MM-DD) in `tz`. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return isoDateInTz(now, tz);
}

/**
 * `YYYY-MM-DDTHH:mm` wall-clock time of `date` in `tz` — the value an
 * `<input type="datetime-local">` expects when the form works in the
 * company's timezone rather than the browser's.
 */
export function wallClockInTz(date: Date, tz: string): string {
  const zoned = toZonedTime(date, tz);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${zoned.getFullYear()}-${p(zoned.getMonth() + 1)}-${p(zoned.getDate())}T${p(zoned.getHours())}:${p(zoned.getMinutes())}`;
}

/**
 * The instant a wall-clock time (`YYYY-MM-DDTHH:mm[:ss]`, or a bare
 * `YYYY-MM-DD` for midnight) names in `tz`. Returns null for input that
 * doesn't parse. Inverse of `wallClockInTz`.
 */
export function instantFromWallClock(local: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(local)) return null;
  const d = fromZonedTime(local.length === 10 ? `${local}T00:00:00` : local, tz);
  return Number.isNaN(d.getTime()) ? null : d;
}
