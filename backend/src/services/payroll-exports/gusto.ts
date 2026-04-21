// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { csvLine, hoursDecimal } from './csv.js';
import type { FormatFn } from './types.js';

/**
 * Gusto "Hours Worked" CSV import. Gusto matches employees by email
 * (strong) or name (weaker) — we emit both so manual mapping in the
 * Gusto UI is unambiguous.
 *
 * Double-overtime, PTO, sick, and holiday are zero for v1 (Vibe PT has
 * no leave-accrual concept); they're emitted as 0.00 so the import
 * template doesn't treat a missing column as an error.
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
    if (e.workSeconds === 0) continue;
    rows.push(
      csvLine([
        e.firstName,
        e.lastName,
        e.email ?? '',
        hoursDecimal(e.regularSeconds),
        hoursDecimal(e.overtimeSeconds),
        '0.00',
        '0.00',
        '0.00',
        '0.00',
      ]),
    );
  }

  return rows.join('');
};
