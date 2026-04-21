// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { TimeFormat } from '../enums.js';
import type { FormatKind } from './parse.js';

export interface FormatOptions {
  /** Decimal precision. Default 2. Ignored in HH:MM mode. */
  precision?: number;
  /** Pad hours to 2 digits in HH:MM output. Default false. */
  padHours?: boolean;
  /** Strip trailing zeros in decimal output. Default true (so `5.80` →
   *  `5.8`, `5.00` → `5`). Disable for column-aligned reports. */
  stripTrailingZeros?: boolean;
  /** Render negative values as `(…)` (CPA-style) rather than with a
   *  leading minus. Default false. */
  parensForNegative?: boolean;
}

/**
 * `formatHours` — canonical seconds → string renderer. All hour-bearing
 * UI and exports route through here so format is never re-implemented
 * in a route handler or component.
 */
export function formatHours(seconds: number, mode: TimeFormat, opts: FormatOptions = {}): string {
  const sign = seconds < 0 ? -1 : 1;
  const abs = Math.abs(seconds);
  const rendered = mode === 'hhmm' ? renderHhmm(abs, opts) : renderDecimal(abs, opts);
  if (sign < 0) {
    return opts.parensForNegative ? `(${rendered})` : `-${rendered}`;
  }
  return rendered;
}

function renderHhmm(seconds: number, opts: FormatOptions): string {
  // Round to whole minutes for HH:MM display. Storage keeps exact seconds;
  // only display rounds — the caller has the raw value if they need it.
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hStr = opts.padHours ? String(h).padStart(2, '0') : String(h);
  const mStr = String(m).padStart(2, '0');
  return `${hStr}:${mStr}`;
}

function renderDecimal(seconds: number, opts: FormatOptions): string {
  const precision = opts.precision ?? 2;
  const hours = seconds / 3600;
  const fixed = hours.toFixed(precision);
  if (opts.stripTrailingZeros === false) return fixed;
  // Strip trailing zeros (but keep at least one digit before the dot and
  // drop a lonely dot): `5.80` → `5.8`, `5.00` → `5`, `0.00` → `0`.
  return fixed.replace(/\.?0+$/, '') || '0';
}

/** Dual readout: primary in the chosen mode, secondary in the other. */
export function formatHoursDual(
  seconds: number,
  primary: TimeFormat,
  opts: FormatOptions = {},
): { primary: string; secondary: string } {
  const other: TimeFormat = primary === 'decimal' ? 'hhmm' : 'decimal';
  return {
    primary: formatHours(seconds, primary, opts),
    secondary: formatHours(seconds, other, opts),
  };
}

/** Convenience: whole minutes → H:MM. Equivalent to `formatHours(m*60, 'hhmm')`. */
export function minutesToHHMM(minutes: number): string {
  return formatHours(minutes * 60, 'hhmm');
}

export function secondsToHHMM(seconds: number): string {
  return formatHours(seconds, 'hhmm');
}

/** Expose FormatKind for callers that want to display "matched as HH:MM". */
export type { FormatKind };
