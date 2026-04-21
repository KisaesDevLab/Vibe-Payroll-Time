// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, expect, it } from 'vitest';
import { buildTimesheetSummary } from '../summary.js';

const tz = 'America/Chicago';

function makeEntry(
  id: number,
  type: 'work' | 'break',
  startIso: string,
  endIso: string | null,
): Parameters<typeof buildTimesheetSummary>[0][number] {
  return {
    id,
    employeeId: 1,
    shiftId: `00000000-0000-4000-a000-00000000000${id}`,
    entryType: type,
    jobId: null,
    startedAt: startIso,
    endedAt: endIso,
  };
}

describe('buildTimesheetSummary', () => {
  const periodStart = new Date('2026-04-13T05:00:00Z'); // Mon Apr 13 00:00 CDT
  const periodEnd = new Date('2026-04-27T05:00:00Z'); // Mon Apr 27 00:00 CDT

  it('aggregates a simple one-day, one-entry timesheet', () => {
    const entries = [
      makeEntry(1, 'work', '2026-04-20T14:00:00Z', '2026-04-20T22:00:00Z'), // 8 hours
    ];
    const s = buildTimesheetSummary(entries, {
      timezone: tz,
      weekStartDay: 1,
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart,
      periodEnd,
    });
    expect(s.periodTotal.workSeconds).toBe(8 * 3600);
    expect(s.days).toHaveLength(1);
    expect(s.days[0]?.date).toBe('2026-04-20');
    expect(s.days[0]?.workSeconds).toBe(8 * 3600);
    expect(s.weeks[0]?.regularSeconds).toBe(8 * 3600);
    expect(s.weeks[0]?.overtimeSeconds).toBe(0);
  });

  it('applies FLSA OT: > 40 hours in a week', () => {
    // Five 9-hour days in one week → 45 hours; 5 OT.
    const days = [0, 1, 2, 3, 4].map((d) => {
      const start = `2026-04-${(20 + d).toString().padStart(2, '0')}T13:00:00Z`;
      const end = `2026-04-${(20 + d).toString().padStart(2, '0')}T22:00:00Z`;
      return makeEntry(d + 1, 'work', start, end);
    });
    const s = buildTimesheetSummary(days, {
      timezone: tz,
      weekStartDay: 1, // Mon
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart,
      periodEnd,
    });
    expect(s.periodTotal.workSeconds).toBe(45 * 3600);
    expect(s.periodTotal.regularSeconds).toBe(40 * 3600);
    expect(s.periodTotal.overtimeSeconds).toBe(5 * 3600);
  });

  it('excludes entries outside the period', () => {
    const entries = [
      makeEntry(1, 'work', '2026-04-10T14:00:00Z', '2026-04-10T22:00:00Z'), // before
      makeEntry(2, 'work', '2026-04-20T14:00:00Z', '2026-04-20T22:00:00Z'), // in
      makeEntry(3, 'work', '2026-04-30T14:00:00Z', '2026-04-30T22:00:00Z'), // after
    ];
    const s = buildTimesheetSummary(entries, {
      timezone: tz,
      weekStartDay: 1,
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart,
      periodEnd,
    });
    expect(s.periodTotal.workSeconds).toBe(8 * 3600);
  });

  it('includes break seconds separately', () => {
    const entries = [
      makeEntry(1, 'work', '2026-04-20T14:00:00Z', '2026-04-20T18:00:00Z'), // 4h
      makeEntry(2, 'break', '2026-04-20T18:00:00Z', '2026-04-20T18:30:00Z'), // 30m
      makeEntry(3, 'work', '2026-04-20T18:30:00Z', '2026-04-20T22:00:00Z'), // 3.5h
    ];
    const s = buildTimesheetSummary(entries, {
      timezone: tz,
      weekStartDay: 1,
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart,
      periodEnd,
    });
    expect(s.periodTotal.workSeconds).toBe(7.5 * 3600);
    expect(s.periodTotal.breakSeconds).toBe(30 * 60);
  });

  it('counts live elapsed time on an open work entry', () => {
    const now = new Date('2026-04-20T18:00:00Z');
    const entries = [makeEntry(1, 'work', '2026-04-20T14:00:00Z', null)]; // open, 4h elapsed
    const s = buildTimesheetSummary(entries, {
      timezone: tz,
      weekStartDay: 1,
      roundingMode: 'none',
      roundingGraceMinutes: 0,
      periodStart,
      periodEnd,
      now,
    });
    expect(s.periodTotal.workSeconds).toBe(4 * 3600);
  });
});
