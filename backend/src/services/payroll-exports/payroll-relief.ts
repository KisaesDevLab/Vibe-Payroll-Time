// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { csvLine, hoursDecimal } from './csv.js';
import type { FormatFn } from './types.js';

/**
 * Payroll Relief time import format.
 *
 * Thomson Reuters CS Professional Suite / Payroll Relief's actual
 * import schema is large and firm-configurable. This emits the most
 * common baseline — one row per employee with total regular + OT for
 * the pay period — that maps directly into the standard "Employee
 * Hours Import" template. Firms with custom earnings codes should
 * round-trip with the generic CSV exporter and a column-mapping
 * template (deferred to a later iteration).
 *
 * See docs/exports/payroll-relief.md for the specific columns.
 */
export const payrollRelief: FormatFn = (ctx) => {
  const rows = [
    csvLine([
      'EmployeeID',
      'LastName',
      'FirstName',
      'RegularHours',
      'OvertimeHours',
      'PeriodStart',
      'PeriodEnd',
    ]),
  ];

  const periodStart = ctx.periodStart.toISOString().slice(0, 10);
  const periodEnd = ctx.periodEnd.toISOString().slice(0, 10);

  for (const e of ctx.employees) {
    if (e.workSeconds === 0) continue;
    rows.push(
      csvLine([
        e.employeeNumber ?? String(e.employeeId),
        e.lastName,
        e.firstName,
        hoursDecimal(e.regularSeconds),
        hoursDecimal(e.overtimeSeconds),
        periodStart,
        periodEnd,
      ]),
    );
  }

  return rows.join('');
};
