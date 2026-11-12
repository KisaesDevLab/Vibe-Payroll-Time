// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { instantFromWallClock, todayInTz, wallClockInTz } from '../tz.js';

describe('company-timezone wall clock', () => {
  it('formats an instant as wall-clock time in the given zone, not UTC', () => {
    // 15:00 UTC on Nov 10 is 9:00 AM in Chicago (CST, UTC−6).
    const d = new Date('2026-11-10T15:00:00Z');
    expect(wallClockInTz(d, 'America/Chicago')).toBe('2026-11-10T09:00');
    expect(wallClockInTz(d, 'America/Phoenix')).toBe('2026-11-10T08:00');
  });

  it('reads wall-clock input in the given zone', () => {
    expect(instantFromWallClock('2026-11-10T09:00', 'America/Chicago')?.toISOString()).toBe(
      '2026-11-10T15:00:00.000Z',
    );
    expect(instantFromWallClock('2026-11-10', 'America/Chicago')?.toISOString()).toBe(
      '2026-11-10T06:00:00.000Z',
    );
  });

  it('round-trips across a DST change', () => {
    const tz = 'America/Chicago';
    for (const local of ['2026-03-07T23:30', '2026-03-08T03:15', '2026-11-01T00:45']) {
      expect(wallClockInTz(instantFromWallClock(local, tz)!, tz)).toBe(local);
    }
  });

  it('rejects malformed input', () => {
    expect(instantFromWallClock('', 'America/Chicago')).toBeNull();
    expect(instantFromWallClock('11/10/2026 9:00', 'America/Chicago')).toBeNull();
    expect(instantFromWallClock('2026-11-10T09:00Z', 'America/Chicago')).toBeNull();
  });

  it('todayInTz uses the zone date, not the UTC date', () => {
    // 03:00 UTC Nov 11 is still Nov 10 in Chicago.
    expect(todayInTz('America/Chicago', new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-10');
    expect(todayInTz('UTC', new Date('2026-11-11T03:00:00Z'))).toBe('2026-11-11');
  });
});
