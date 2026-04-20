import { describe, expect, it } from 'vitest';
import { roundTimestamp, roundedDurationSeconds } from '../rounding.js';

function at(h: number, m: number, s = 0): Date {
  return new Date(Date.UTC(2026, 3, 20, h, m, s));
}

describe('roundTimestamp — mode=none', () => {
  it('is the identity', () => {
    const t = at(10, 3);
    expect(
      roundTimestamp(t, { mode: 'none', graceMinutes: 0, direction: 'in' }).getTime(),
    ).toBe(t.getTime());
  });
});

describe('roundTimestamp — 15min with grace 0 (always round)', () => {
  const opts = { mode: '15min' as const, graceMinutes: 0 };

  it('rounds down when closer to the prior boundary', () => {
    expect(roundTimestamp(at(10, 7), { ...opts, direction: 'in' })).toEqual(at(10, 0));
  });

  it('rounds up when closer to the next boundary', () => {
    expect(roundTimestamp(at(10, 8), { ...opts, direction: 'in' })).toEqual(at(10, 15));
  });

  it('breaks ties by direction', () => {
    // Exactly at 10:07:30 — equidistant to :00 and :15.
    const mid = at(10, 7, 30);
    expect(roundTimestamp(mid, { ...opts, direction: 'in' })).toEqual(at(10, 15));
    expect(roundTimestamp(mid, { ...opts, direction: 'out' })).toEqual(at(10, 0));
  });
});

describe('roundTimestamp — 15min with 7-min grace (classic 7-min rule)', () => {
  const opts = { mode: '15min' as const, graceMinutes: 7 };

  it('rounds within grace to the nearest boundary', () => {
    expect(roundTimestamp(at(10, 5), { ...opts, direction: 'in' })).toEqual(at(10, 0));
    expect(roundTimestamp(at(10, 12), { ...opts, direction: 'in' })).toEqual(at(10, 15));
  });

  it('leaves timestamps outside the grace window alone', () => {
    // At 10:09 the nearest boundary (10:15) is 6 min away — within 7-min
    // grace → snap to 10:15. At 10:08:30 nearest is 6:30 — still inside.
    // Construct a clearly-outside case: grace 3 min, interval 15 min.
    const strict = { mode: '15min' as const, graceMinutes: 3, direction: 'in' as const };
    expect(roundTimestamp(at(10, 10), strict)).toEqual(at(10, 10)); // 5min from 10:15 > grace
  });
});

describe('roundedDurationSeconds', () => {
  it('applies in/out rounding at both endpoints', () => {
    const start = at(10, 3);
    const end = at(12, 12);
    // 15-min grace=0: start 10:03→10:00 (in favors up-on-tie; here rounds down),
    // end 12:12→12:15. Duration: 135 min = 8100 s.
    expect(
      roundedDurationSeconds(start, end, { mode: '15min', graceMinutes: 0 }),
    ).toBe(135 * 60);
  });

  it('returns 0 when rounded interval is inverted', () => {
    const start = at(10, 14);
    const end = at(10, 16);
    // 15-min, grace=0: start 10:14 → 10:15; end 10:16 → 10:15. Duration 0.
    expect(
      roundedDurationSeconds(start, end, { mode: '15min', graceMinutes: 0 }),
    ).toBe(0);
  });
});
