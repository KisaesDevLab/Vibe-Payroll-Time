// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { buildTimesheetSummary, type SummaryEntry, type TimeOffJobInfo } from '../summary.js';

/**
 * Time off (PTO, sick, holiday, unpaid) is recorded as entries on
 * time-off job codes. FLSA overtime is based on hours actually worked,
 * so time off must never reach the 40-hour weekly threshold.
 */
const tz = 'America/Chicago';
const periodStart = new Date('2026-04-20T05:00:00Z'); // Mon Apr 20 00:00 CDT
const periodEnd = new Date('2026-04-27T05:00:00Z');

const PTO = 900;
const SICK = 901;
const UNPAID = 902;
const timeOffJobs = new Map<number, TimeOffJobInfo>([
  [PTO, { category: 'pto', isPaid: true }],
  [SICK, { category: 'sick', isPaid: true }],
  [UNPAID, { category: 'unpaid', isPaid: false }],
]);

let nextId = 1;
function work(day: number, hours: number, jobId: number | null = null): SummaryEntry {
  const start = new Date(Date.UTC(2026, 3, 20 + day, 13, 0, 0));
  return {
    id: nextId++,
    employeeId: 1,
    shiftId: `00000000-0000-4000-a000-${String(nextId).padStart(12, '0')}`,
    entryType: 'work',
    jobId,
    startedAt: start,
    endedAt: new Date(start.getTime() + hours * 3600_000),
  };
}
/** A manual time-off entry: local midnight + duration. */
function timeOff(day: number, hours: number, jobId: number): SummaryEntry {
  const start = new Date(Date.UTC(2026, 3, 20 + day, 5, 0, 0));
  return {
    ...work(day, hours, jobId),
    startedAt: start,
    endedAt: new Date(start.getTime() + hours * 3600_000),
  };
}

const opts = {
  timezone: tz,
  weekStartDay: 1,
  roundingMode: '15min' as const,
  roundingGraceMinutes: 0,
  periodStart,
  periodEnd,
  timeOffJobs,
};

describe('buildTimesheetSummary — time off', () => {
  it('38 worked + 8 PTO = 0 overtime, 46 paid', () => {
    const entries = [0, 1, 2, 3].map((d) => work(d, 9.5)).concat([timeOff(4, 8, PTO)]);
    const s = buildTimesheetSummary(entries, opts);
    expect(s.periodTotal.workSeconds).toBe(38 * 3600);
    expect(s.periodTotal.overtimeSeconds).toBe(0);
    expect(s.timeOff.totalSeconds).toBe(8 * 3600);
    expect(s.timeOff.paidSeconds).toBe(8 * 3600);
    expect(s.timeOff.byCategory.pto).toBe(8 * 3600);
    expect(s.periodTotal.workSeconds + s.timeOff.paidSeconds).toBe(46 * 3600);
  });

  it('OT is max(0, worked - 40) whatever time off is mixed in', () => {
    const entries = [0, 1, 2, 3, 4]
      .map((d) => work(d, 9))
      .concat([timeOff(5, 8, PTO), timeOff(6, 4, SICK)]);
    const s = buildTimesheetSummary(entries, opts);
    expect(s.periodTotal.workSeconds).toBe(45 * 3600);
    expect(s.periodTotal.overtimeSeconds).toBe(5 * 3600);
    expect(s.weeks[0]?.workSeconds).toBe(45 * 3600);
    expect(s.timeOff.totalSeconds).toBe(12 * 3600);
  });

  it('a week of only time off has no worked hours and no overtime', () => {
    const entries = [0, 1, 2, 3, 4, 5].map((d) => timeOff(d, 8, PTO));
    const s = buildTimesheetSummary(entries, opts);
    expect(s.periodTotal.workSeconds).toBe(0);
    expect(s.periodTotal.overtimeSeconds).toBe(0);
    expect(s.weeks).toHaveLength(0);
    expect(s.timeOff.totalSeconds).toBe(48 * 3600);
  });

  it('separates paid from unpaid, keeps time off out of the job breakdown, and is never rounded', () => {
    const entries = [work(0, 8, 7), timeOff(1, 7.9, UNPAID), timeOff(2, 3, PTO)];
    const s = buildTimesheetSummary(entries, opts);
    expect(s.timeOff.unpaidSeconds).toBe(Math.round(7.9 * 3600));
    expect(s.timeOff.paidSeconds).toBe(3 * 3600);
    expect(s.jobBreakdown).toEqual([{ jobId: 7, workSeconds: 8 * 3600 }]);
    expect(s.timeOffBreakdown.map((t) => t.jobId).sort()).toEqual([PTO, UNPAID]);
    const day = s.days.find((d) => d.date === '2026-04-21');
    expect(day?.workSeconds).toBe(0);
    expect(day?.timeOffSeconds).toBe(Math.round(7.9 * 3600));
  });

  it('without timeOffJobs every work entry is worked time (backwards compatible)', () => {
    const entries = [timeOff(0, 8, PTO)];
    const { timeOffJobs: _drop, ...plain } = opts;
    const s = buildTimesheetSummary(entries, plain);
    expect(s.periodTotal.workSeconds).toBe(8 * 3600);
    expect(s.timeOff.totalSeconds).toBe(0);
  });

  it('fuzz: overtime always equals max(0, worked − 40h) per week', () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 200; run++) {
      const entries: SummaryEntry[] = [];
      for (let d = 0; d < 7; d++) {
        if (rand() < 0.7) entries.push(work(d, Math.round(rand() * 12 * 4) / 4));
        if (rand() < 0.3)
          entries.push(timeOff(d, Math.round(rand() * 8 * 4) / 4, rand() < 0.5 ? PTO : UNPAID));
      }
      const s = buildTimesheetSummary(entries, { ...opts, roundingMode: 'none' });
      const worked = s.periodTotal.workSeconds;
      expect(s.periodTotal.overtimeSeconds).toBe(Math.max(0, worked - 40 * 3600));
    }
  });
});
