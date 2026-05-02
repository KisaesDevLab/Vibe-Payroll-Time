// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, expect, it } from 'vitest';
import { buildTimesheetSummary } from '../summary.js';
import { isoDateInTz, startOfDayInTz, addDaysInTz } from '../tz.js';
import { resolveWorkWeek } from '../week.js';

// Phase 14.2 DST regression tests. Catch the two paths where naive TZ
// math breaks payroll:
//
//   - Spring forward (US 2025-03-09): 02:00 doesn't exist; clocks jump
//     from 01:59 to 03:00. A punch from 01:30 to 03:30 wall-clock took
//     1 real hour, not 2. We must report 3600 seconds, not 7200.
//   - Fall back   (US 2025-11-02): 01:00–02:00 happens twice. A punch
//     from 01:30 CDT to 01:30 CST (1 real hour later) took 1 real
//     hour. We must not double-count.
//
// The summary builder operates on UTC instants throughout, so these
// tests pass the right UTC pairs and assert that:
//   1. Reported work-seconds equals real elapsed seconds.
//   2. The civil-day grouping puts each punch on the right local day.
//   3. The FLSA workweek boundary computed via resolveWorkWeek
//      lands on the same civil date for entries before and after
//      the transition.

const tz = 'America/Chicago';

function makeWorkEntry(id: number, startIso: string, endIso: string) {
  return {
    id,
    employeeId: 1,
    shiftId: `00000000-0000-4000-a000-00000000000${id}`,
    entryType: 'work' as const,
    jobId: null,
    startedAt: startIso,
    endedAt: endIso,
  };
}

describe('DST — spring forward (US 2025-03-09 02:00 → 03:00)', () => {
  // Wall-clock punch: 01:30 CST → 03:30 CDT. Real elapsed: 1 hour.
  // 01:30 CST = 07:30 UTC. 03:30 CDT = 08:30 UTC. UTC delta: 1 hour.
  const startUtc = '2025-03-09T07:30:00Z';
  const endUtc = '2025-03-09T08:30:00Z';

  it('reports 1.0 hours of work-seconds across the spring-forward boundary', () => {
    const summary = buildTimesheetSummary([makeWorkEntry(1, startUtc, endUtc)], {
      timezone: tz,
      weekStartDay: 0,
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart: new Date('2025-03-02T06:00:00Z'),
      periodEnd: new Date('2025-03-16T06:00:00Z'),
    });
    expect(summary.periodTotal.workSeconds).toBe(3600);
    expect(summary.days).toHaveLength(1);
    expect(summary.days[0]?.workSeconds).toBe(3600);
  });

  it('groups the punch under the local civil date 2025-03-09', () => {
    expect(isoDateInTz(new Date(startUtc), tz)).toBe('2025-03-09');
    expect(isoDateInTz(new Date(endUtc), tz)).toBe('2025-03-09');
  });

  it('local midnight on 2025-03-09 is recoverable as a single instant', () => {
    const midnight = startOfDayInTz(new Date(startUtc), tz);
    // 2025-03-09 00:00 CST = 2025-03-09 06:00 UTC
    expect(midnight.toISOString()).toBe('2025-03-09T06:00:00.000Z');
  });

  it('FLSA workweek boundary computed across the boundary stays a 7-civil-day window', () => {
    // Sunday-anchored week containing 2025-03-09 (itself a Sunday).
    const week = resolveWorkWeek(new Date(startUtc), { weekStartDay: 0, timezone: tz });
    // Week starts at 2025-03-09 00:00 CST = 2025-03-09 06:00 UTC.
    expect(week.start.toISOString()).toBe('2025-03-09T06:00:00.000Z');
    // Adding 7 civil days lands on 2025-03-16 00:00 CDT = 2025-03-16 05:00 UTC
    // (after spring-forward, CDT is UTC-5 instead of CST's UTC-6, so
    // the UTC instant is one hour earlier than a naive +7×24h would
    // give).
    expect(week.end.toISOString()).toBe('2025-03-16T05:00:00.000Z');
    const expectedEnd = addDaysInTz(week.start, 7, tz);
    expect(week.end.toISOString()).toBe(expectedEnd.toISOString());
  });
});

describe('DST — fall back (US 2025-11-02 02:00 → 01:00)', () => {
  // Wall-clock punch: 01:30 CDT → 01:30 CST. Real elapsed: 1 hour.
  // 01:30 CDT = 06:30 UTC. 01:30 CST = 07:30 UTC. UTC delta: 1 hour.
  const startUtc = '2025-11-02T06:30:00Z';
  const endUtc = '2025-11-02T07:30:00Z';

  it('reports 1.0 hours of work-seconds across the fall-back boundary', () => {
    const summary = buildTimesheetSummary([makeWorkEntry(1, startUtc, endUtc)], {
      timezone: tz,
      weekStartDay: 0,
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart: new Date('2025-10-26T05:00:00Z'),
      periodEnd: new Date('2025-11-09T06:00:00Z'),
    });
    // The single punch is one real hour — it must not double-count
    // because the wall clock visited 01:30 twice.
    expect(summary.periodTotal.workSeconds).toBe(3600);
    expect(summary.days).toHaveLength(1);
    expect(summary.days[0]?.date).toBe('2025-11-02');
    expect(summary.days[0]?.workSeconds).toBe(3600);
  });

  it('local midnight on 2025-11-02 is recoverable as a single instant', () => {
    const midnight = startOfDayInTz(new Date(startUtc), tz);
    // 2025-11-02 00:00 CDT = 2025-11-02 05:00 UTC
    expect(midnight.toISOString()).toBe('2025-11-02T05:00:00.000Z');
  });

  it('FLSA workweek boundary keeps a 7-civil-day window across the boundary', () => {
    // Sunday-anchored week containing 2025-11-02 (itself a Sunday).
    const week = resolveWorkWeek(new Date(startUtc), { weekStartDay: 0, timezone: tz });
    expect(week.start.toISOString()).toBe('2025-11-02T05:00:00.000Z');
    // 2025-11-09 00:00 CST = 2025-11-09 06:00 UTC. After fall-back the
    // offset is UTC-6 again, so the week is 25 hours of wall-clock
    // long but still 7 civil days.
    expect(week.end.toISOString()).toBe('2025-11-09T06:00:00.000Z');
  });
});

describe('FLSA workweek — non-Sunday workweek_start_day', () => {
  // Confirm the OT engine respects the per-firm workweek start. A
  // 50-hour week starting Sunday counts only Sunday's hours toward
  // last week's OT when the firm's workweek start is Monday.
  it('Monday-start workweek puts Saturday and Sunday in the previous week', () => {
    // Take a Sunday timestamp (2025-04-06 12:00 UTC) and resolve the
    // FLSA workweek with Monday start. Expected: the Sunday belongs
    // to the workweek that starts 2025-03-31 (the prior Monday).
    const sunday = new Date('2025-04-06T12:00:00Z');
    const week = resolveWorkWeek(sunday, { weekStartDay: 1, timezone: tz });
    // Monday 2025-03-31 00:00 CDT = 2025-03-31 05:00 UTC
    expect(week.start.toISOString()).toBe('2025-03-31T05:00:00.000Z');
    // Monday 2025-04-07 00:00 CDT = 2025-04-07 05:00 UTC
    expect(week.end.toISOString()).toBe('2025-04-07T05:00:00.000Z');
  });

  it('Sunday-start workweek puts the same Sunday in this week, not last', () => {
    const sunday = new Date('2025-04-06T12:00:00Z');
    const week = resolveWorkWeek(sunday, { weekStartDay: 0, timezone: tz });
    expect(week.start.toISOString()).toBe('2025-04-06T05:00:00.000Z');
    expect(week.end.toISOString()).toBe('2025-04-13T05:00:00.000Z');
  });
});
