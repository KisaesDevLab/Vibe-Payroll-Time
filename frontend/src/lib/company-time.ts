// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { instantFromWallClock, wallClockInTz } from '@vibept/shared';

/**
 * Date and time helpers for screens that work in the COMPANY's timezone.
 *
 * Two kinds of value flow through timesheet screens and they must not be
 * mixed up:
 *  - civil days (`YYYY-MM-DD`): already resolved in the company tz by the
 *    server. Arithmetic on them is pure string/UTC math, and rendering
 *    them uses `timeZone: 'UTC'` so no zone can shift them a day.
 *  - instants (ISO timestamps): shown and entered as wall-clock time in
 *    the company tz, never the browser's.
 */

/** `iso` (YYYY-MM-DD) moved by `days` civil days. Pure date math: no
 *  local midnight, no DST. */
export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a civil day. */
export function isoDayOfWeek(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** First day of the week containing `todayIso`, for a company whose weeks
 *  start on `weekStartDay` (0 = Sunday). */
export function weekStartFor(todayIso: string, weekStartDay: number): string {
  const back = (isoDayOfWeek(todayIso) - weekStartDay + 7) % 7;
  return shiftIsoDate(todayIso, -back);
}

/** First of the month containing `todayIso`, and the first of the next. */
export function monthBounds(todayIso: string): { first: string; firstOfNext: string } {
  const [y, m] = todayIso.split('-').map(Number) as [number, number];
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return { first, firstOfNext: `${ny}-${String(nm).padStart(2, '0')}-01` };
}

/** `YYYY-MM-DD` of the browser's local today. Fallback only, for the
 *  moment before the company's timezone has loaded. */
export function browserTodayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

/** Value for an `<input type="datetime-local">` showing `iso` in `tz`. */
export function toZoneInput(iso: string | null | undefined, tz: string): string {
  return iso ? wallClockInTz(new Date(iso), tz) : '';
}

/** ISO instant for a datetime-local value read as wall-clock time in `tz`;
 *  null when empty or unparseable. */
export function fromZoneInput(local: string, tz: string): string | null {
  if (!local) return null;
  return instantFromWallClock(local, tz)?.toISOString() ?? null;
}

export interface ShiftSpan {
  startedAt: string;
  endedAt: string;
  /** Clock-out was at or before clock-in, so the shift ends the next day. */
  overnight: boolean;
  seconds: number;
}

/**
 * The instants a shift entered as a civil day plus clock-in and clock-out
 * times (`HH:mm`) names in `tz`. A clock-out at or before the clock-in
 * ends on the next civil day; that day's wall clock is resolved on its
 * own, so a DST change overnight gives the real elapsed time.
 */
export function buildShiftSpan(
  day: string,
  clockIn: string,
  clockOut: string,
  tz: string,
): ShiftSpan | null {
  if (!day || !clockIn || !clockOut) return null;
  const start = instantFromWallClock(`${day}T${clockIn}`, tz);
  let end = instantFromWallClock(`${day}T${clockOut}`, tz);
  if (!start || !end) return null;
  const overnight = end <= start;
  if (overnight) {
    end = instantFromWallClock(`${shiftIsoDate(day, 1)}T${clockOut}`, tz);
    if (!end || end <= start) return null;
  }
  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    overnight,
    seconds: Math.round((end.getTime() - start.getTime()) / 1000),
  };
}

/**
 * Proposed changes for an edit correction: only the fields whose
 * company-tz wall clock differs from the entry's current value.
 */
export function correctionChanges(
  entry: { startedAt: string; endedAt: string | null },
  input: { startedAt: string; endedAt: string },
  tz: string,
): { startedAt?: string; endedAt?: string } {
  const changes: { startedAt?: string; endedAt?: string } = {};
  if (input.startedAt && input.startedAt !== toZoneInput(entry.startedAt, tz)) {
    const iso = fromZoneInput(input.startedAt, tz);
    if (iso) changes.startedAt = iso;
  }
  if (input.endedAt && input.endedAt !== toZoneInput(entry.endedAt, tz)) {
    const iso = fromZoneInput(input.endedAt, tz);
    if (iso) changes.endedAt = iso;
  }
  return changes;
}

/** Short zone name ("CST", "GMT+2") of `tz` at `at`. */
export function zoneAbbreviation(tz: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName');
    return part?.value ?? null;
  } catch {
    return null;
  }
}

/** "Times are in America/Chicago (CST)" when the company's zone isn't the
 *  browser's; null when they agree and the label would be noise. */
export function zoneNotice(tz: string, browserTz: string = browserTimezone()): string | null {
  if (!tz || tz === browserTz) return null;
  const abbr = zoneAbbreviation(tz);
  return `Times are in ${tz}${abbr ? ` (${abbr})` : ''}`;
}

/** Clock time of an instant in `tz`, e.g. "8:05 AM". */
export function formatClock(iso: string, tz: string | undefined): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

/** Render a civil day (`YYYY-MM-DD`) without any zone shifting it. */
export function formatCivilDay(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' },
): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}
