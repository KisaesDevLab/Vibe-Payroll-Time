// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { GENERIC_COLUMN_KEYS, formatHours, type GenericColumnKey } from '@vibept/shared';
import { BadRequest } from '../../http/errors.js';
import { csvLine, hoursDecimal } from './csv.js';
import type { EmployeeSummary, ExportContext, FormatFn } from './types.js';

/**
 * Generic CSV exporter. Columns + order are configurable per run.
 * Firms with a custom vendor or spreadsheet template pick which
 * columns they want; we emit exactly those columns, in that order,
 * with the configured label as the header.
 *
 * Column keys are drawn from GENERIC_COLUMN_KEYS (exported from shared)
 * so the UI's checklist matches what the server accepts.
 *
 * Time format: hour columns render in either decimal or HH:MM per
 * `ctx.genericTimeFormat` (defaults to decimal when absent). Vendor
 * formats (Payroll Relief / Gusto / QBO) always stay decimal because
 * those targets only ingest decimal natively.
 */
const HEADER_LABELS: Record<GenericColumnKey, string> = {
  employee_number: 'Employee #',
  last_name: 'Last name',
  first_name: 'First name',
  email: 'Email',
  regular_hours: 'Regular hours',
  overtime_hours: 'Overtime hours',
  break_hours: 'Break hours',
  total_hours: 'Total hours',
  job_breakdown_json: 'Job breakdown',
  period_start: 'Period start',
  period_end: 'Period end',
  manual_hours: 'Manual hours',
  source: 'Source',
  override_reasons: 'Override reasons',
};

export const genericCsv: FormatFn = (ctx) => {
  const columns = (
    ctx.genericColumns && ctx.genericColumns.length > 0
      ? ctx.genericColumns
      : ([
          'employee_number',
          'last_name',
          'first_name',
          'regular_hours',
          'overtime_hours',
          'total_hours',
        ] satisfies GenericColumnKey[])
  ) as GenericColumnKey[];

  for (const c of columns) {
    if (!(GENERIC_COLUMN_KEYS as readonly string[]).includes(c)) {
      throw BadRequest(`Unknown generic column: ${c}`);
    }
  }

  const rows = [csvLine(columns.map((c) => HEADER_LABELS[c]))];
  const periodStart = ctx.periodStart.toISOString().slice(0, 10);
  const periodEnd = ctx.periodEnd.toISOString().slice(0, 10);

  for (const e of ctx.employees) {
    if (e.workSeconds === 0) continue;
    const cells = columns.map((c) => formatCellFor(c, e, periodStart, periodEnd, ctx));
    rows.push(csvLine(cells));
  }

  return rows.join('');
};

function renderHours(seconds: number, ctx: ExportContext): string {
  if (ctx.genericTimeFormat === 'hhmm') {
    return formatHours(seconds, 'hhmm');
  }
  return hoursDecimal(seconds);
}

function sourceLabelFor(e: EmployeeSummary): string {
  const hasManual = e.manualSeconds > 0;
  const hasPunched = e.workSeconds - e.manualSeconds > 0;
  if (hasManual && hasPunched) return 'punched+manual';
  if (hasManual) return 'web_manual';
  if (hasPunched) return 'punched';
  return '';
}

function formatCellFor(
  column: GenericColumnKey,
  e: EmployeeSummary,
  periodStart: string,
  periodEnd: string,
  ctx: ExportContext,
): string | number {
  switch (column) {
    case 'employee_number':
      return e.employeeNumber ?? String(e.employeeId);
    case 'last_name':
      return e.lastName;
    case 'first_name':
      return e.firstName;
    case 'email':
      return e.email ?? '';
    case 'regular_hours':
      return renderHours(e.regularSeconds, ctx);
    case 'overtime_hours':
      return renderHours(e.overtimeSeconds, ctx);
    case 'break_hours':
      return renderHours(e.breakSeconds, ctx);
    case 'total_hours':
      return renderHours(e.workSeconds, ctx);
    case 'manual_hours':
      return renderHours(e.manualSeconds, ctx);
    case 'source':
      return sourceLabelFor(e);
    case 'override_reasons':
      return e.overrideReasons.join(' · ');
    case 'job_breakdown_json':
      return JSON.stringify(
        e.byJob.map((j) => ({ jobCode: j.jobCode, hours: Number(hoursDecimal(j.workSeconds)) })),
      );
    case 'period_start':
      return periodStart;
    case 'period_end':
      return periodEnd;
    default: {
      const _exhaustive: never = column;
      throw new Error(`unreachable: ${String(_exhaustive)}`);
    }
  }
}
