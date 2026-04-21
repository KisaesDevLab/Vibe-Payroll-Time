// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * `parseHours` — lenient input parser that converts a user-typed time
 * string into whole-second storage.
 *
 * Three accepted shapes (strictly distinguishable, never guessing):
 *   decimal  — `5`, `5.0`, `5.80`, `.5`
 *   hhmm     — `5:48`, `05:48`, or `5:48:30` if opts.allowSecondsPrecision
 *   labeled  — `5h 48m`, `5hr 48min`, `5 hrs`, `30m`, `90min`
 *
 * Ambiguous or malformed inputs return a structured error code — never a
 * silent normalization. "5 48" with whitespace between numbers is
 * `AMBIGUOUS` because that's exactly the kind of input that becomes a
 * wage-and-hour claim if we guessed wrong.
 */

export type FormatKind = 'decimal' | 'hhmm' | 'labeled';

export type ParseError =
  | 'EMPTY'
  | 'NEGATIVE'
  | 'OVER_DAY'
  | 'BAD_COLON_FORMAT'
  | 'BAD_MINUTES'
  | 'BAD_SECONDS'
  | 'MIXED'
  | 'BAD_LABEL'
  | 'AMBIGUOUS'
  | 'NOT_A_NUMBER';

export interface ParseResult {
  seconds: number;
  matched: FormatKind;
}

export interface ParseFailure {
  error: ParseError;
}

export interface ParseOptions {
  /** Allow HH:MM:SS — off by default because most payroll targets
   *  resolve to minutes and seconds-precision is a footgun for the
   *  typical user. */
  allowSecondsPrecision?: boolean;
  /** Reject values >= 24 hours. Default true — a single day's cell can't
   *  hold more than a day. Weekly-total parsing can disable this. */
  maxOneDay?: boolean;
}

const ONE_DAY_SECONDS = 86_400;

/** Strip common noise (NBSP, tabs, trailing/leading whitespace). Keeps
 *  internal whitespace so label/colon disambiguation still works. */
function normalizeInput(raw: string): string {
  return raw
    .replace(/\u00A0/g, ' ') // NBSP → space
    .replace(/\t/g, ' ')
    .trim()
    .toLowerCase();
}

function fail(error: ParseError): ParseFailure {
  return { error };
}

function ok(seconds: number, matched: FormatKind): ParseResult {
  return { seconds, matched };
}

/** Decimal shape: integer or float, optional leading zero, optional
 *  trailing zeros. Regex is anchored so stray characters reject. */
const DECIMAL_RE = /^(\d+)(\.\d+)?$|^\.(\d+)$/;

/** HH:MM or HH:MM:SS shape. Captures are strings to preserve leading
 *  zeros in the zero-pad rule checks. */
const COLON_RE = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

/** Labeled shape. Accepts any combination of hours-then-minutes with
 *  the canonical suffix variants. The regex groups are:
 *    1: hours integer or float (may be absent)
 *    2: "h"/"hr"/"hrs" (may be absent if only minutes)
 *    3: minutes integer (may be absent if only hours)
 *    4: "m"/"min"/"mins"
 *
 *  Requirement: order is hours-then-minutes. Reversing to `48m 5h`
 *  rejects as BAD_LABEL since that's ambiguous to a CPA auditor. */
const LABELED_RE = /^(?:(\d+(?:\.\d+)?)\s*(h|hr|hrs))?\s*(?:(\d+)\s*(m|min|mins))?$/;

/** Used to reject accidental mixed format like "5.30:15" or "5:48h". */
const HAS_COLON = /:/;
const HAS_LABEL = /[a-z]/;
const HAS_DOT = /\./;

export function parseHours(rawInput: string, opts: ParseOptions = {}): ParseResult | ParseFailure {
  const input = normalizeInput(rawInput);
  if (!input) return fail('EMPTY');
  if (input.startsWith('-')) return fail('NEGATIVE');

  const hasColon = HAS_COLON.test(input);
  const hasLabel = HAS_LABEL.test(input);
  const hasDot = HAS_DOT.test(input);

  // Mixed-format detection runs before any single parser so we don't
  // accidentally half-match a bad string.
  if (hasColon && hasLabel) return fail('MIXED');
  if (hasColon && hasDot) return fail('MIXED');

  // Whitespace between two bare numbers is ambiguous ("5 48" could be
  // 5h48m OR a typo for 5:48 OR 5.48). Only accept whitespace when it's
  // adjacent to a label letter (`5 h 48 m`).
  if (/\s/.test(input) && !hasLabel) return fail('AMBIGUOUS');

  // Reject stray non-whitespace characters outside allowed alphabets.
  // Allowed: digits, `.`, `:`, `h`, `r`, `s`, `m`, `i`, `n`, whitespace.
  if (!/^[\d.:hrminsx\s]+$/.test(input)) return fail('BAD_LABEL');

  if (hasColon) {
    return parseColon(input, opts);
  }
  if (hasLabel) {
    return parseLabeled(input, opts);
  }
  return parseDecimal(input, opts);
}

function parseDecimal(input: string, opts: ParseOptions): ParseResult | ParseFailure {
  const m = DECIMAL_RE.exec(input);
  if (!m) return fail('NOT_A_NUMBER');
  const n = Number(input);
  if (!Number.isFinite(n)) return fail('NOT_A_NUMBER');
  if (n < 0) return fail('NEGATIVE');
  const seconds = Math.round(n * 3600);
  if ((opts.maxOneDay ?? true) && seconds >= ONE_DAY_SECONDS) return fail('OVER_DAY');
  return ok(seconds, 'decimal');
}

function parseColon(input: string, opts: ParseOptions): ParseResult | ParseFailure {
  // Catch inputs like "5:48:30:10" — more than 2 colons, regex won't match.
  if ((input.match(/:/g) ?? []).length > 2) return fail('BAD_COLON_FORMAT');
  const m = COLON_RE.exec(input);
  if (!m) return fail('BAD_COLON_FORMAT');
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] !== undefined ? Number(m[3]) : 0;
  if (min > 59) return fail('BAD_MINUTES');
  if (s > 59) return fail('BAD_SECONDS');
  if (m[3] !== undefined && !opts.allowSecondsPrecision) {
    return fail('BAD_COLON_FORMAT');
  }
  const seconds = h * 3600 + min * 60 + s;
  if ((opts.maxOneDay ?? true) && seconds >= ONE_DAY_SECONDS) return fail('OVER_DAY');
  return ok(seconds, 'hhmm');
}

function parseLabeled(input: string, opts: ParseOptions): ParseResult | ParseFailure {
  // Collapse interior whitespace before regex to simplify the pattern.
  const collapsed = input.replace(/\s+/g, '').replace(/([hmrins])([0-9])/g, '$1 $2');
  // After collapsing, re-split on the single whitespace between units so
  // the regex can see `5h` and `48m` as logical groups.
  const normalized = collapsed.replace(/\s+/g, ' ').trim();
  const m = LABELED_RE.exec(normalized);
  if (!m) return fail('BAD_LABEL');

  const hStr = m[1];
  const hUnit = m[2];
  const minStr = m[3];
  const minUnit = m[4];

  // Must have at least one unit.
  if (!hUnit && !minUnit) return fail('BAD_LABEL');
  // If an hours value is present, its unit must be present (same for
  // minutes). The regex already enforces this; double-check for safety.
  if (hStr && !hUnit) return fail('BAD_LABEL');
  if (minStr && !minUnit) return fail('BAD_LABEL');

  const h = hStr ? Number(hStr) : 0;
  const min = minStr ? Number(minStr) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(min)) return fail('NOT_A_NUMBER');
  if (h < 0 || min < 0) return fail('NEGATIVE');
  const seconds = Math.round(h * 3600 + min * 60);
  if ((opts.maxOneDay ?? true) && seconds >= ONE_DAY_SECONDS) return fail('OVER_DAY');
  return ok(seconds, 'labeled');
}

/**
 * Best-effort detection without actually parsing. Used by the live
 * parse-hint strip so the label ("You typed HH:MM") updates on every
 * keystroke, even while the input is still partial.
 */
export function detectFormatKind(rawInput: string): 'decimal' | 'hhmm' | 'labeled' | 'ambiguous' {
  const input = normalizeInput(rawInput);
  if (!input) return 'ambiguous';
  if (HAS_COLON.test(input)) return 'hhmm';
  if (HAS_LABEL.test(input)) return 'labeled';
  if (/^-?[\d.]+$/.test(input)) return 'decimal';
  return 'ambiguous';
}
