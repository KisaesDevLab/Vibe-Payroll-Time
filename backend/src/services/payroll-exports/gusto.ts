// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { csvLine, hoursDecimal } from './csv.js';
import { hasHours, paidTimeOff, type FormatFn } from './types.js';

/**
 * Gusto "Hours Worked" CSV import. Gusto matches employees by email
 * (strong) or name (weaker) — we emit both so manual mapping in the
 * Gusto UI is unambiguous.
 *
 * PTO, sick and holiday hours come from time-off codes (paid ones
 * only). Paid codes in the "other" category (bereavement, jury duty, …)
 * are added to pto_hours, Gusto's catch-all for paid leave. Unpaid leave
 * is not exported. Double overtime is always 0.00: Vibe PT computes
 * federal FLSA overtime only.
 *
 * See docs/exports/gusto.md.
 */
export const gusto: FormatFn = (ctx) => {
  const rows = [
    csvLine([
      'first_name',
      'last_name',
      'email',
      'regular_hours',
      'overtime_hours',
      'double_overtime_hours',
      'pto_hours',
      'holiday_hours',
      'sick_hours',
    ]),
  ];

  for (const e of ctx.employees) {
    if (!hasHours(e)) continue;
    const paid = paidTimeOff(e);
    rows.push(
      csvLine([
        e.firstName,
        e.lastName,
        e.email ?? '',
        hoursDecimal(e.regularSeconds),
        hoursDecimal(e.overtimeSeconds),
        '0.00',
        hoursDecimal(paid.pto + paid.other),
        hoursDecimal(paid.holiday),
        hoursDecimal(paid.sick),
      ]),
    );
  }

  return rows.join('');
};
