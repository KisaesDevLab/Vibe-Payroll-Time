// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, expect, it } from 'vitest';
import { detectFormatKind, parseHours, type ParseError } from '../parse.js';

// Compact assertion helpers — the golden table below is the real
// interface documentation, so the helpers stay tight.
function expectOk(input: string, seconds: number, matched: 'decimal' | 'hhmm' | 'labeled'): void {
  const r = parseHours(input);
  if ('error' in r) throw new Error(`expected ok for "${input}" but got ${r.error}`);
  expect(r.seconds).toBe(seconds);
  expect(r.matched).toBe(matched);
}

function expectErr(input: string, code: ParseError): void {
  const r = parseHours(input);
  if (!('error' in r)) throw new Error(`expected error for "${input}" but got ${r.seconds}s`);
  expect(r.error).toBe(code);
}

describe('parseHours — decimal', () => {
  it.each([
    ['0', 0],
    ['5', 18_000],
    ['5.0', 18_000],
    ['5.5', 19_800],
    ['5.80', 20_880],
    ['5.8', 20_880],
    ['0.5', 1_800],
    ['.5', 1_800],
  ] as const)('decimal "%s" = %i seconds', (input, seconds) => {
    expectOk(input, seconds, 'decimal');
  });
});

describe('parseHours — HH:MM', () => {
  it.each([
    ['0:00', 0],
    ['0:30', 1_800],
    ['5:48', 20_880],
    ['05:48', 20_880],
    ['23:59', 86_340],
    ['8:00', 28_800],
  ] as const)('hhmm "%s" = %i seconds', (input, seconds) => {
    expectOk(input, seconds, 'hhmm');
  });
});

describe('parseHours — labeled', () => {
  it.each([
    ['1h', 3_600],
    ['5h 48m', 20_880],
    ['5hr 48min', 20_880],
    ['5h48m', 20_880],
    ['5 hrs', 18_000],
    ['48m', 2_880],
    ['48 min', 2_880],
    ['90m', 5_400],
    ['90min', 5_400],
    ['30m', 1_800],
  ] as const)('labeled "%s" = %i seconds', (input, seconds) => {
    expectOk(input, seconds, 'labeled');
  });
});

describe('parseHours — whitespace / casing', () => {
  it('trims surrounding whitespace', () => {
    expectOk('  5:48  ', 20_880, 'hhmm');
  });
  it('uppercases labels ok', () => {
    expectOk('5H 48M', 20_880, 'labeled');
  });
  it('tabs and NBSP are squashed', () => {
    expectOk('\t5h 48m', 20_880, 'labeled');
  });
});

describe('parseHours — rejections', () => {
  it.each([
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['-1', 'NEGATIVE'],
    ['-0.5', 'NEGATIVE'],
    ['24', 'OVER_DAY'],
    ['24:00', 'OVER_DAY'],
    ['48:00', 'OVER_DAY'],
    ['5:60', 'BAD_MINUTES'],
    ['5:99', 'BAD_MINUTES'],
    ['5:48:30', 'BAD_COLON_FORMAT'], // seconds rejected by default
    ['5:48:30:10', 'BAD_COLON_FORMAT'],
    ['5.30:15', 'MIXED'],
    ['5:48h', 'MIXED'],
    ['5 48', 'AMBIGUOUS'],
    ['five hours', 'BAD_LABEL'],
    ['5 h 48 m 30 s', 'BAD_LABEL'], // 's' is not an allowed label letter for plain seconds
    ['90s', 'BAD_LABEL'],
    ['abc', 'BAD_LABEL'],
  ] as const)('rejects "%s" as %s', (input, code) => {
    expectErr(input, code);
  });
});

describe('parseHours — option flags', () => {
  it('allows HH:MM:SS when opt is set', () => {
    const r = parseHours('5:48:30', { allowSecondsPrecision: true });
    expect(r).toEqual({ seconds: 20_910, matched: 'hhmm' });
  });
  it('allows > 24h when maxOneDay=false', () => {
    const r = parseHours('40:00', { maxOneDay: false });
    expect(r).toEqual({ seconds: 144_000, matched: 'hhmm' });
  });
});

describe('detectFormatKind', () => {
  it.each([
    ['5.8', 'decimal'],
    ['5:48', 'hhmm'],
    ['5h', 'labeled'],
    ['5h 48m', 'labeled'],
    ['', 'ambiguous'],
    ['5 48', 'ambiguous'], // numeric but with whitespace — user hasn't committed yet
  ] as const)('detects "%s" → %s', (input, expected) => {
    expect(detectFormatKind(input)).toBe(expected);
  });
});
