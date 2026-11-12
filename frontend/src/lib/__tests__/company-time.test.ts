// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { formatHours, todayInTz } from '@vibept/shared';
import { describe, expect, it } from 'vitest';
import {
  buildShiftSpan,
  correctionChanges,
  fromZoneInput,
  monthBounds,
  shiftIsoDate,
  toZoneInput,
  weekStartFor,
  zoneNotice,
} from '../company-time';
import { describeCorrection } from '../correction-summary';

// Every helper takes the zone explicitly, so these hold whatever zone the
// test runner's machine is in: the "browser" zone never enters the math.
const CHICAGO = 'America/Chicago';
const TOKYO = 'Asia/Tokyo';

describe('shiftIsoDate (gotoWeek arithmetic)', () => {
  it('moves by whole weeks across month and year boundaries', () => {
    expect(shiftIsoDate('2026-11-29', 7)).toBe('2026-12-06');
    expect(shiftIsoDate('2026-12-27', 7)).toBe('2027-01-03');
    expect(shiftIsoDate('2027-01-03', -7)).toBe('2026-12-27');
    expect(shiftIsoDate('2028-02-27', 7)).toBe('2028-03-05'); // leap year
  });

  it('is not shifted by a DST change in the week', () => {
    // US clocks fall back on 2026-11-01 and spring forward on 2027-03-14.
    expect(shiftIsoDate('2026-10-25', 7)).toBe('2026-11-01');
    expect(shiftIsoDate('2027-03-14', -7)).toBe('2027-03-07');
  });
});

describe('weekStartFor', () => {
  it('anchors on a Sunday week start', () => {
    expect(weekStartFor('2026-11-11', 0)).toBe('2026-11-08'); // Wed → Sun
    expect(weekStartFor('2026-11-08', 0)).toBe('2026-11-08'); // already Sunday
  });

  it('anchors on a Monday week start, including from a Sunday', () => {
    expect(weekStartFor('2026-11-11', 1)).toBe('2026-11-09');
    expect(weekStartFor('2026-11-08', 1)).toBe('2026-11-02');
  });

  it('crosses a year boundary', () => {
    expect(weekStartFor('2027-01-01', 0)).toBe('2026-12-27');
  });

  it('starts from the company-tz today, not the UTC date', () => {
    // 03:30 UTC on Sunday Nov 8 is still Saturday Nov 7 in Chicago, so a
    // Sunday-start company is still in the week of Nov 1.
    const now = new Date('2026-11-08T03:30:00Z');
    expect(now.toISOString().slice(0, 10)).toBe('2026-11-08');
    expect(weekStartFor(todayInTz(CHICAGO, now), 0)).toBe('2026-11-01');
  });
});

describe('monthBounds', () => {
  it('gives the first of this and the next month', () => {
    expect(monthBounds('2026-11-11')).toEqual({ first: '2026-11-01', firstOfNext: '2026-12-01' });
    expect(monthBounds('2026-12-31')).toEqual({ first: '2026-12-01', firstOfNext: '2027-01-01' });
  });
});

describe('datetime-local inputs in the company zone', () => {
  it('shows an instant as company wall clock, not UTC or browser time', () => {
    // 14:05 UTC = 08:05 CST.
    expect(toZoneInput('2026-11-10T14:05:00.000Z', CHICAGO)).toBe('2026-11-10T08:05');
    expect(toZoneInput('2026-11-10T14:05:00.000Z', TOKYO)).toBe('2026-11-10T23:05');
    expect(toZoneInput(null, CHICAGO)).toBe('');
  });

  it('reads a wall-clock value back as the instant in the company zone', () => {
    expect(fromZoneInput('2026-11-10T08:05', CHICAGO)).toBe('2026-11-10T14:05:00.000Z');
    expect(fromZoneInput('', CHICAGO)).toBeNull();
    expect(fromZoneInput('not a time', CHICAGO)).toBeNull();
  });

  it('round-trips across the DST change', () => {
    // CDT (UTC-5) before Nov 1, CST (UTC-6) after.
    for (const iso of ['2026-10-31T13:00:00.000Z', '2026-11-02T14:00:00.000Z']) {
      expect(fromZoneInput(toZoneInput(iso, CHICAGO), CHICAGO)).toBe(iso);
    }
  });
});

describe('correctionChanges (Request correction modal)', () => {
  const entry = { startedAt: '2026-11-10T14:00:00.000Z', endedAt: '2026-11-10T22:30:00.000Z' };

  it('proposes nothing when the employee changed nothing', () => {
    const input = {
      startedAt: toZoneInput(entry.startedAt, CHICAGO),
      endedAt: toZoneInput(entry.endedAt, CHICAGO),
    };
    expect(input).toEqual({ startedAt: '2026-11-10T08:00', endedAt: '2026-11-10T16:30' });
    expect(correctionChanges(entry, input, CHICAGO)).toEqual({});
  });

  it('proposes only the changed end, read in the company zone', () => {
    const changes = correctionChanges(
      entry,
      { startedAt: '2026-11-10T08:00', endedAt: '2026-11-10T17:00' },
      CHICAGO,
    );
    // 17:00 CST is 23:00 UTC — not 17:00 UTC, and not the browser's 17:00.
    expect(changes).toEqual({ endedAt: '2026-11-10T23:00:00.000Z' });
  });

  it('adds an end to an open entry', () => {
    const open = { startedAt: entry.startedAt, endedAt: null };
    expect(
      correctionChanges(
        open,
        { startedAt: '2026-11-10T08:00', endedAt: '2026-11-10T12:00' },
        CHICAGO,
      ),
    ).toEqual({ endedAt: '2026-11-10T18:00:00.000Z' });
  });
});

describe('buildShiftSpan (Add time modal)', () => {
  it('builds the instants from the company-tz day and times', () => {
    expect(buildShiftSpan('2026-11-10', '08:00', '16:30', CHICAGO)).toEqual({
      startedAt: '2026-11-10T14:00:00.000Z',
      endedAt: '2026-11-10T22:30:00.000Z',
      overnight: false,
      seconds: 8.5 * 3600,
    });
  });

  it('gives a different instant for the same entry in another company zone', () => {
    expect(buildShiftSpan('2026-11-10', '08:00', '16:30', TOKYO)?.startedAt).toBe(
      '2026-11-09T23:00:00.000Z',
    );
  });

  it('runs an earlier clock-out into the next day', () => {
    const span = buildShiftSpan('2026-11-10', '22:00', '06:00', CHICAGO);
    expect(span).toMatchObject({
      startedAt: '2026-11-11T04:00:00.000Z',
      endedAt: '2026-11-11T12:00:00.000Z',
      overnight: true,
      seconds: 8 * 3600,
    });
  });

  it('counts the real elapsed time over a DST change at night', () => {
    // Fall back: Oct 31 22:00 CDT → Nov 1 06:00 CST is 9 hours.
    expect(buildShiftSpan('2026-10-31', '22:00', '06:00', CHICAGO)?.seconds).toBe(9 * 3600);
    // Spring forward: Mar 13 22:00 CST → Mar 14 06:00 CDT is 7 hours.
    expect(buildShiftSpan('2027-03-13', '22:00', '06:00', CHICAGO)?.seconds).toBe(7 * 3600);
  });

  it('is null until the form is complete', () => {
    expect(buildShiftSpan('2026-11-10', '08:00', '', CHICAGO)).toBeNull();
    expect(buildShiftSpan('', '08:00', '16:00', CHICAGO)).toBeNull();
  });
});

describe('zoneNotice', () => {
  it('labels inputs only when the company zone differs from the browser', () => {
    expect(zoneNotice(CHICAGO, CHICAGO)).toBeNull();
    expect(zoneNotice(CHICAGO, TOKYO)).toMatch(/^Times are in America\/Chicago/);
  });
});

describe('describeCorrection', () => {
  it('states an added shift in company time and the viewer format', () => {
    const text = describeCorrection(
      {
        requestType: 'add',
        timeEntryId: null,
        proposedChanges: {
          startedAt: '2026-11-10T14:00:00.000Z',
          endedAt: '2026-11-10T22:30:00.000Z',
        },
      },
      CHICAGO,
      'hhmm',
    );
    expect(text).toMatch(/^Add shift: /);
    expect(text).toMatch(/8:00/);
    expect(text).toMatch(/4:30/);
    expect(text).toContain(`(${formatHours(8.5 * 3600, 'hhmm')} hrs)`);
  });

  it('lists the proposed fields of an edit', () => {
    const text = describeCorrection(
      {
        requestType: 'edit',
        timeEntryId: 12,
        proposedChanges: { endedAt: '2026-11-10T23:00:00.000Z' },
      },
      CHICAGO,
      'decimal',
    );
    expect(text).toMatch(/^Change entry #12: end → .*5:00/);
  });
});
