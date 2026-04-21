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

export function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'number' ? String(value) : value;
  if (/[",\r\n]/.test(raw)) return '"' + raw.replace(/"/g, '""') + '"';
  return raw;
}

export function hoursDecimal(seconds: number, places = 2): string {
  return (seconds / 3600).toFixed(places);
}
