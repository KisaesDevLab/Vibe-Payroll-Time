// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/**
 * A summary row a report appends (the time card's TOTAL and TIME OFF
 * lines, the hours-by-period TOTAL). Kept apart from report-pdf so the
 * on-screen table can use it without loading jsPDF.
 */
export function isTotalRow(row: Record<string, unknown>): boolean {
  return Object.values(row).some((v) => typeof v === 'string' && /^(TOTAL|TIME OFF ·)/.test(v));
}
