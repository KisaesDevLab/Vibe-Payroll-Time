import { describe, expect, it } from 'vitest';
import { parseHours, type ParseError } from '../parse.js';

/**
 * 10,000 randomly-generated strings. Every result must be either a
 * valid `{seconds, matched}` or a valid `{error: ParseError}` — we must
 * never throw and must never return a shape that doesn't fit the
 * discriminated union.
 */

const VALID_ERRORS: ReadonlySet<ParseError> = new Set<ParseError>([
  'EMPTY',
  'NEGATIVE',
  'OVER_DAY',
  'BAD_COLON_FORMAT',
  'BAD_MINUTES',
  'BAD_SECONDS',
  'MIXED',
  'BAD_LABEL',
  'AMBIGUOUS',
  'NOT_A_NUMBER',
]);

function rand(n: number): number {
  return Math.floor(Math.random() * n);
}

// Fixed seed-ish generator — produces a mix of plausible and adversarial
// inputs. Goal: exercise every parse branch and every rejection.
const CHAR_POOL = [
  ...'0123456789'.split(''),
  ':',
  '.',
  ' ',
  '-',
  ...'hmrins'.split(''),
  // Occasional bogus chars to make sure we reject cleanly.
  'x',
  '@',
];

function randomInput(): string {
  const len = 1 + rand(20);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += CHAR_POOL[rand(CHAR_POOL.length)];
  }
  return out;
}

describe('parseHours fuzz', () => {
  it('10k random strings never throw and always return a well-formed result', () => {
    for (let i = 0; i < 10_000; i++) {
      const input = randomInput();
      const result = parseHours(input);
      if ('error' in result) {
        expect(VALID_ERRORS.has(result.error)).toBe(true);
      } else {
        expect(Number.isFinite(result.seconds)).toBe(true);
        expect(result.seconds >= 0).toBe(true);
        expect(['decimal', 'hhmm', 'labeled']).toContain(result.matched);
      }
    }
  });
});
