import { describe, expect, it } from 'vitest';
import { formatHours, formatHoursDual, minutesToHHMM, secondsToHHMM } from '../format.js';
import { parseHours } from '../parse.js';

describe('formatHours — HH:MM', () => {
  it.each([
    [0, '0:00'],
    [1_800, '0:30'],
    [20_880, '5:48'],
    [28_800, '8:00'],
  ] as const)('seconds %i → "%s"', (seconds, expected) => {
    expect(formatHours(seconds, 'hhmm')).toBe(expected);
  });

  it('pads hours with padHours=true', () => {
    expect(formatHours(20_880, 'hhmm', { padHours: true })).toBe('05:48');
  });

  it('rounds to whole minutes', () => {
    // 5:48:12 → 5:48 (round down past half)
    expect(formatHours(20_892, 'hhmm')).toBe('5:48');
    // 5:48:30 → 5:49 (round up at tie)
    expect(formatHours(20_910, 'hhmm')).toBe('5:49');
  });
});

describe('formatHours — decimal', () => {
  it.each([
    [0, '0'],
    [1_800, '0.5'],
    [20_880, '5.8'],
    [20_520, '5.7'],
    [28_800, '8'],
  ] as const)('seconds %i → "%s" (default strip)', (seconds, expected) => {
    expect(formatHours(seconds, 'decimal')).toBe(expected);
  });

  it('keeps trailing zeros when stripTrailingZeros=false', () => {
    expect(formatHours(20_880, 'decimal', { stripTrailingZeros: false })).toBe('5.80');
    expect(formatHours(28_800, 'decimal', { stripTrailingZeros: false })).toBe('8.00');
  });

  it('honors precision', () => {
    expect(formatHours(20_892, 'decimal', { precision: 4, stripTrailingZeros: false })).toBe(
      '5.8033',
    );
  });
});

describe('formatHours — negative', () => {
  it('prefixes with minus by default', () => {
    expect(formatHours(-5_400, 'hhmm')).toBe('-1:30');
    expect(formatHours(-5_400, 'decimal')).toBe('-1.5');
  });
  it('uses parens when opted-in', () => {
    expect(formatHours(-5_400, 'hhmm', { parensForNegative: true })).toBe('(1:30)');
    expect(formatHours(-5_400, 'decimal', { parensForNegative: true })).toBe('(1.5)');
  });
});

describe('formatHoursDual', () => {
  it('returns both readouts', () => {
    expect(formatHoursDual(20_880, 'hhmm')).toEqual({ primary: '5:48', secondary: '5.8' });
    expect(formatHoursDual(20_880, 'decimal')).toEqual({ primary: '5.8', secondary: '5:48' });
  });
});

describe('convenience helpers', () => {
  it('minutesToHHMM', () => {
    expect(minutesToHHMM(348)).toBe('5:48');
  });
  it('secondsToHHMM', () => {
    expect(secondsToHHMM(20_880)).toBe('5:48');
  });
});

describe('round-trip — parseHours(formatHours(n)) === n', () => {
  // Minute-aligned whole values round-trip exactly in both modes.
  it('every minute from 0 to 24h round-trips in HH:MM', () => {
    for (let m = 0; m < 24 * 60; m++) {
      const s = m * 60;
      const formatted = formatHours(s, 'hhmm');
      const parsed = parseHours(formatted);
      if ('error' in parsed) throw new Error(`parse failed for ${formatted}: ${parsed.error}`);
      expect(parsed.seconds).toBe(s);
    }
  });

  it('every 15-min increment round-trips in decimal', () => {
    for (let m = 0; m < 24 * 60; m += 15) {
      const s = m * 60;
      // decimal format with stripTrailingZeros=true produces "5" not "5.00";
      // parseHours accepts both shapes.
      const formatted = formatHours(s, 'decimal');
      const parsed = parseHours(formatted);
      if ('error' in parsed) throw new Error(`parse failed for ${formatted}: ${parsed.error}`);
      expect(parsed.seconds).toBe(s);
    }
  });
});
