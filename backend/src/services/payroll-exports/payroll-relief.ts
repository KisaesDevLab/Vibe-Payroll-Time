// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { csvLine, hoursDecimal } from './csv.js';
import { hasHours, paidTimeOff, type FormatFn } from './types.js';

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
 * Paid time off is appended after PeriodEnd (PTOHours, SickHours,
 * HolidayHours, OtherPaidLeaveHours) so a template mapped to the
 * original seven columns keeps working. Unpaid leave is not exported.
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
      'PTOHours',
      'SickHours',
      'HolidayHours',
      'OtherPaidLeaveHours',
    ]),
  ];

  const periodStart = ctx.periodStart.toISOString().slice(0, 10);
  const periodEnd = ctx.periodEnd.toISOString().slice(0, 10);

  for (const e of ctx.employees) {
    if (!hasHours(e)) continue;
    const paid = paidTimeOff(e);
    rows.push(
      csvLine([
        e.employeeNumber ?? String(e.employeeId),
        e.lastName,
        e.firstName,
        hoursDecimal(e.regularSeconds),
        hoursDecimal(e.overtimeSeconds),
        periodStart,
        periodEnd,
        hoursDecimal(paid.pto),
        hoursDecimal(paid.sick),
        hoursDecimal(paid.holiday),
        hoursDecimal(paid.other),
      ]),
    );
  }

  return rows.join('');
};
