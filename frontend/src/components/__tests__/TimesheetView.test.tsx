// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { render, screen, within } from '@testing-library/react';
import type { TimeEntry, TimesheetResponse } from '@vibept/shared';
import { describe, expect, it, vi } from 'vitest';
import { TimesheetView } from '../TimesheetView';

function entry(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: 1,
    companyId: 1,
    employeeId: 1,
    shiftId: 's',
    entryType: 'work',
    jobId: null,
    // 13:37Z is 7:37 AM in Chicago (CST).
    startedAt: '2026-11-11T13:37:00.000Z',
    endedAt: '2026-11-12T01:37:00.000Z',
    durationSeconds: 12 * 3600,
    source: 'kiosk',
    sourceOffline: false,
    isAutoClosed: true,
    approvedAt: null,
    supersededByEntryId: null,
    startedLocation: null,
    startedLocationStatus: null,
    endedLocation: null,
    endedLocationStatus: null,
    ...over,
  } as unknown as TimeEntry;
}

function sheet(entries: TimeEntry[]): TimesheetResponse {
  return {
    employee: { id: 1, firstName: 'Kurt', lastName: 'K', companyId: 1 },
    period: {
      start: '2026-11-01T05:00:00.000Z',
      end: '2026-11-15T06:00:00.000Z',
      firstDay: '2026-11-01',
      lastDay: '2026-11-14',
      type: 'bi_weekly',
    },
    companyTimezone: 'America/Chicago',
    timeFormat: 'decimal',
    entries,
    days: [
      {
        date: '2026-11-11',
        workSeconds: 12 * 3600,
        breakSeconds: 0,
        timeOffSeconds: 0,
        entryIds: entries.map((e) => e.id),
      },
    ],
    weeks: [],
    totals: {
      workSeconds: 12 * 3600,
      breakSeconds: 0,
      regularSeconds: 12 * 3600,
      overtimeSeconds: 0,
    },
    jobBreakdown: [],
    timeOff: { totalSeconds: 0, paidSeconds: 0, unpaidSeconds: 0, byCategory: {} },
    timeOffBreakdown: [],
    timeOffSelfEntry: false,
    isApproved: false,
    approvedAt: null,
  } as unknown as TimesheetResponse;
}

describe('TimesheetView', () => {
  it('gives phones a card per entry with every field, and keeps the table for wider screens', () => {
    render(<TimesheetView data={sheet([entry({})])} onRequestCorrection={vi.fn()} />);

    const card = screen.getByRole('listitem');
    // Phone card: hidden from sm up; shows times in company tz, hours with a
    // unit, source badges and the actions without sideways scrolling.
    expect(card.closest('ul')?.className).toContain('sm:hidden');
    expect(within(card).getByText(/7:37\s?AM → 7:37\s?PM/)).toBeTruthy();
    expect(within(card).getByText('12 hrs')).toBeTruthy();
    expect(within(card).getByText('auto-closed')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Request fix' })).toBeTruthy();

    // Table: hidden on phones, same entry and actions.
    const table = screen.getByRole('table', { hidden: true });
    expect(table.parentElement?.className).toContain('hidden');
    expect(table.parentElement?.className).toContain('sm:block');
    expect(within(table).getByRole('button', { name: 'Request fix', hidden: true })).toBeTruthy();
  });

  it('shows time off as hours only on the phone card', () => {
    const pto = entry({ id: 2, jobId: 9, isAutoClosed: false, durationSeconds: 8 * 3600 });
    const data = sheet([pto]);
    data.timeOffBreakdown = [{ jobId: 9, category: 'pto', isPaid: true, seconds: 8 * 3600 }];
    render(<TimesheetView data={data} />);
    const card = screen.getByRole('listitem');
    expect(within(card).queryByText(/→/)).toBeNull();
    expect(within(card).getByText('8 hrs')).toBeTruthy();
  });
});
