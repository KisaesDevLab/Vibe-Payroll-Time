import { GENERIC_COLUMN_KEYS, type GenericColumnKey } from '@vibept/shared';
import { BadRequest } from '../../http/errors.js';
import { csvLine, hoursDecimal } from './csv.js';
import type { EmployeeSummary, FormatFn } from './types.js';

/**
 * Generic CSV exporter. Columns + order are configurable per run.
 * Firms with a custom vendor or spreadsheet template pick which
 * columns they want; we emit exactly those columns, in that order,
 * with the configured label as the header.
 *
 * Column keys are drawn from GENERIC_COLUMN_KEYS (exported from shared)
 * so the UI's checklist matches what the server accepts.
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
    const cells = columns.map((c) => formatCellFor(c, e, periodStart, periodEnd));
    rows.push(csvLine(cells));
  }

  return rows.join('');
};

function formatCellFor(
  column: GenericColumnKey,
  e: EmployeeSummary,
  periodStart: string,
  periodEnd: string,
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
      return hoursDecimal(e.regularSeconds);
    case 'overtime_hours':
      return hoursDecimal(e.overtimeSeconds);
    case 'break_hours':
      return hoursDecimal(e.breakSeconds);
    case 'total_hours':
      return hoursDecimal(e.workSeconds);
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
