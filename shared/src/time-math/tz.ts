// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
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
