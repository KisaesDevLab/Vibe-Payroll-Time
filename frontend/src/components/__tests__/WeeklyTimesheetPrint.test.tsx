// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { render, screen } from '@testing-library/react';
import type { TimeEntry, WeeklyGridResponse } from '@vibept/shared';
import { describe, expect, it } from 'vitest';
import { WeeklyTimesheetPrint, entriesByDay, isoDateInTz } from '../WeeklyTimesheetPrint';

const DAYS = [
  '2026-10-25',
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
];

function entry(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1,
    companyId: 3,
    employeeId: 7,
    shiftId: '00000000-0000-4000-8000-000000000000',
    entryType: 'work',
    jobId: 10,
    startedAt: '2026-10-26T15:00:00.000Z',
    endedAt: '2026-10-26T23:30:00.000Z',
    durationSeconds: 30_600,
    source: 'kiosk',
    sourceOffline: false,
    sourceIp: null,
    sourceUserAgent: null,
    startedLocation: null,
    startedLocationStatus: null,
    endedLocation: null,
    endedLocationStatus: null,
    approvedAt: null,
    approvedBy: null,
    isAutoClosed: false,
    entryReason: null,
    supersededByEntryId: null,
    supersedesEntryIds: null,
    isManual: false,
    createdAt: '2026-10-26T15:00:00.000Z',
    updatedAt: '2026-10-26T23:30:00.000Z',
    ...over,
  };
}

function grid(entries: TimeEntry[]): WeeklyGridResponse {
  return {
    employee: { id: 7, firstName: 'Ada', lastName: 'Lovelace', companyId: 3 },
    company: { name: 'Acme Plumbing', timezone: 'America/Los_Angeles' },
    week: { start: DAYS[0]!, end: DAYS[6]! },
    jobs: [
      {
        id: 10,
        code: 'J-100',
        name: 'Main St remodel',
        archivedAt: null,
        isTimeOff: false,
        timeOffCategory: null,
        isPaid: true,
      },
    ],
    days: DAYS.map((date) => ({
      date,
      totalSeconds: date === '2026-10-26' ? 30_600 : 0,
      timeOffSeconds: 0,
      hasException: false,
      hasManual: false,
    })),
    cells: [
      {
        jobId: 10,
        date: '2026-10-26',
        seconds: 30_600,
        sourceTag: 'punched',
        manualEntryId: null,
        entryReason: null,
        locked: false,
        punchEntryIds: [1],
      },
    ],
    jobTotals: [{ jobId: 10, seconds: 30_600 }],
    entries,
    weekTotalSeconds: 30_600,
    weekTimeOffSeconds: 0,
    timeOffByCategory: { pto: 0, sick: 0, holiday: 0, unpaid: 0, other: 0 },
    timeOffSelfEntry: true,
    allApproved: false,
    timeFormat: 'decimal',
  };
}

describe('WeeklyTimesheetPrint', () => {
  it('prints the header, the hours grid and each entry in company time', () => {
    render(<WeeklyTimesheetPrint grid={grid([entry({})])} format="decimal" />);
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Acme Plumbing')).toBeTruthy();
    // 15:00Z / 23:30Z are 8:00 AM / 4:30 PM in Los Angeles (PDT).
    expect(screen.getByText(/8:00/)).toBeTruthy();
    expect(screen.getByText(/4:30/)).toBeTruthy();
    expect(screen.getAllByText('8.5').length).toBeGreaterThanOrEqual(3); // cell, row, entry
    expect(screen.getByText('Kiosk')).toBeTruthy();
    expect(screen.getByText('Employee signature')).toBeTruthy();
  });

  it('flags open and auto-closed entries in the notes column', () => {
    render(
      <WeeklyTimesheetPrint
        grid={grid([
          entry({ id: 1, isAutoClosed: true }),
          entry({
            id: 2,
            startedAt: '2026-10-27T15:00:00.000Z',
            endedAt: null,
            durationSeconds: null,
          }),
        ])}
        format="decimal"
      />,
    );
    expect(screen.getByText('Auto-closed')).toBeTruthy();
    expect(screen.getByText('Still open')).toBeTruthy();
  });
});

describe('entriesByDay', () => {
  it('buckets by the company-local start day, not the UTC day', () => {
    // 2026-10-27 05:00Z is still Oct 26 at 10 PM in Los Angeles.
    const late = entry({ id: 5, startedAt: '2026-10-27T05:00:00.000Z' });
    const byDay = entriesByDay(grid([late]));
    expect(byDay.get('2026-10-26')?.map((e) => e.id)).toEqual([5]);
    expect(byDay.get('2026-10-27')).toEqual([]);
    expect(isoDateInTz(late.startedAt, 'UTC')).toBe('2026-10-27');
  });
});
