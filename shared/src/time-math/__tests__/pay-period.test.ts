import { describe, expect, it } from 'vitest';
import { resolvePayPeriod } from '../pay-period.js';

const tz = 'America/Chicago';

// Use April 20 2026 (a Monday) as the reference instant, civil time 10:00.
// In Central Daylight Time (UTC-5), 10:00 CDT is 15:00 UTC.
const REFERENCE = new Date('2026-04-20T15:00:00Z');

function iso(d: Date): string {
  return d.toISOString();
}

describe('resolvePayPeriod — weekly (week starts Sunday)', () => {
  it('returns the Sunday-to-next-Sunday window', () => {
    const p = resolvePayPeriod(REFERENCE, {
      type: 'weekly',
      weekStartDay: 0,
      timezone: tz,
    });
    // Sunday 2026-04-19 midnight CDT = 2026-04-19T05:00Z
    expect(iso(p.start)).toBe('2026-04-19T05:00:00.000Z');
    expect(iso(p.end)).toBe('2026-04-26T05:00:00.000Z');
  });
});

describe('resolvePayPeriod — weekly (week starts Monday)', () => {
  it('returns the Monday-to-next-Monday window', () => {
    const p = resolvePayPeriod(REFERENCE, {
      type: 'weekly',
      weekStartDay: 1,
      timezone: tz,
    });
    expect(iso(p.start)).toBe('2026-04-20T05:00:00.000Z');
    expect(iso(p.end)).toBe('2026-04-27T05:00:00.000Z');
  });
});

describe('resolvePayPeriod — bi-weekly', () => {
  it('respects the anchor date for alignment', () => {
    // Anchor: 2026-01-04 (Sunday, start of a pay period).
    const anchor = new Date('2026-01-04T06:00:00Z'); // 00:00 CST
    const p = resolvePayPeriod(REFERENCE, {
      type: 'bi_weekly',
      weekStartDay: 0,
      anchorDate: anchor,
      timezone: tz,
    });
    // 2026-04-20 falls between 2026-04-12 (start) and 2026-04-26 (end).
    // 14 civil days from anchor: 01-04 → 01-18 → 02-01 → 02-15 → 03-01 →
    // 03-15 → 03-29 → 04-12 (start) → 04-26 (end, exclusive).
    expect(iso(p.start)).toBe('2026-04-12T05:00:00.000Z');
    expect(iso(p.end)).toBe('2026-04-26T05:00:00.000Z');
  });

  it('produces windows that tile without gaps', () => {
    const anchor = new Date('2026-01-04T06:00:00Z');
    const mid = new Date('2026-05-01T15:00:00Z');
    const p1 = resolvePayPeriod(new Date('2026-04-25T15:00:00Z'), {
      type: 'bi_weekly',
      weekStartDay: 0,
      anchorDate: anchor,
      timezone: tz,
    });
    const p2 = resolvePayPeriod(mid, {
      type: 'bi_weekly',
      weekStartDay: 0,
      anchorDate: anchor,
      timezone: tz,
    });
    expect(p2.start.getTime()).toBe(p1.end.getTime());
  });
});

describe('resolvePayPeriod — semi-monthly', () => {
  it('returns 1st→16th for the 1st half', () => {
    const p = resolvePayPeriod(new Date('2026-04-05T15:00:00Z'), {
      type: 'semi_monthly',
      weekStartDay: 0,
      timezone: tz,
    });
    expect(iso(p.start)).toBe('2026-04-01T05:00:00.000Z');
    expect(iso(p.end)).toBe('2026-04-16T05:00:00.000Z');
  });

  it('returns 16th→1st of next month for the 2nd half', () => {
    const p = resolvePayPeriod(new Date('2026-04-20T15:00:00Z'), {
      type: 'semi_monthly',
      weekStartDay: 0,
      timezone: tz,
    });
    expect(iso(p.start)).toBe('2026-04-16T05:00:00.000Z');
    expect(iso(p.end)).toBe('2026-05-01T05:00:00.000Z');
  });
});

describe('resolvePayPeriod — monthly', () => {
  it('returns calendar-month window in company tz', () => {
    const p = resolvePayPeriod(REFERENCE, {
      type: 'monthly',
      weekStartDay: 0,
      timezone: tz,
    });
    expect(iso(p.start)).toBe('2026-04-01T05:00:00.000Z');
    expect(iso(p.end)).toBe('2026-05-01T05:00:00.000Z');
  });
});
