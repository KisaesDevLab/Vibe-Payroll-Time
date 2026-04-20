import { csvLine, hoursDecimal } from './csv.js';
import type { FormatFn } from './types.js';

/**
 * QuickBooks Online Payroll — time-activity import. QBO breaks hours
 * out per (employee, service item) where "service item" maps from our
 * Job concept. Employees with work on multiple jobs get multiple rows;
 * employees with no job associated get a single row with service item
 * blank.
 *
 * QBO also distinguishes regular from overtime per line; we attribute
 * OT to the "most recent" job by allocating OT to the job with the
 * largest work_seconds share. Good enough for the import template; firms
 * can fine-tune in QBO post-import.
 *
 * See docs/exports/qbo-payroll.md.
 */
export const qboPayroll: FormatFn = (ctx) => {
  const rows = [
    csvLine([
      'EmployeeName',
      'EmployeeEmail',
      'ServiceItem',
      'RegularHours',
      'OvertimeHours',
      'PayDate',
      'Memo',
    ]),
  ];

  const payDate = ctx.periodEnd.toISOString().slice(0, 10);

  for (const e of ctx.employees) {
    if (e.workSeconds === 0) continue;
    const name = `${e.firstName} ${e.lastName}`;

    if (e.byJob.length === 0) {
      rows.push(
        csvLine([
          name,
          e.email ?? '',
          '',
          hoursDecimal(e.regularSeconds),
          hoursDecimal(e.overtimeSeconds),
          payDate,
          `Vibe PT pay period ${ctx.periodStart.toISOString().slice(0, 10)}`,
        ]),
      );
      continue;
    }

    // Allocate OT to the largest job proportionally; spread regular
    // hours by share of work_seconds per job.
    const totalJobSeconds = e.byJob.reduce((s, j) => s + j.workSeconds, 0) || 1;
    let otRemaining = e.overtimeSeconds;
    let regularRemaining = e.regularSeconds;

    // Ensure rounding errors don't leave fractions unassigned — distribute
    // the last job a computed remainder.
    for (let i = 0; i < e.byJob.length; i++) {
      const j = e.byJob[i]!;
      const isLast = i === e.byJob.length - 1;
      const shareRegular = isLast
        ? regularRemaining
        : Math.round((j.workSeconds / totalJobSeconds) * e.regularSeconds);
      const shareOt = isLast
        ? otRemaining
        : Math.round((j.workSeconds / totalJobSeconds) * e.overtimeSeconds);
      regularRemaining -= shareRegular;
      otRemaining -= shareOt;

      if (shareRegular === 0 && shareOt === 0) continue;

      rows.push(
        csvLine([
          name,
          e.email ?? '',
          j.jobCode ?? '',
          hoursDecimal(Math.max(0, shareRegular)),
          hoursDecimal(Math.max(0, shareOt)),
          payDate,
          `Vibe PT pay period ${ctx.periodStart.toISOString().slice(0, 10)}`,
        ]),
      );
    }
  }

  return rows.join('');
};
