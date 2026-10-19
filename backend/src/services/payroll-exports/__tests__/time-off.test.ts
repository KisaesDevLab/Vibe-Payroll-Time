// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { emptyTimeOffTotals } from '@vibept/shared';
import { describe, expect, it } from 'vitest';
import { genericCsv } from '../generic-csv.js';
import { gusto } from '../gusto.js';
import { payrollRelief } from '../payroll-relief.js';
import { qboPayroll } from '../qbo-payroll.js';
import type { EmployeeSummary, ExportContext } from '../types.js';

const H = 3600;

function employee(over: Partial<EmployeeSummary> = {}): EmployeeSummary {
  const timeOff = emptyTimeOffTotals();
  timeOff.byCategory.pto = 8 * H;
  timeOff.byCategory.holiday = 8 * H;
  timeOff.byCategory.unpaid = 4 * H;
  timeOff.paidSeconds = 16 * H;
  timeOff.unpaidSeconds = 4 * H;
  timeOff.totalSeconds = 20 * H;
  return {
    employeeId: 1,
    employeeNumber: 'E1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
    regularSeconds: 30 * H,
    overtimeSeconds: 0,
    breakSeconds: 0,
    workSeconds: 30 * H,
    byJob: [],
    manualSeconds: 0,
    overrideReasons: [],
    timeOff,
    timeOffByJob: [
      { jobId: 10, jobCode: 'PTO', category: 'pto', isPaid: true, seconds: 8 * H },
      { jobId: 11, jobCode: 'HOLIDAY', category: 'holiday', isPaid: true, seconds: 8 * H },
      { jobId: 12, jobCode: 'UNPAID', category: 'unpaid', isPaid: false, seconds: 4 * H },
    ],
    ...over,
  };
}

function ctx(employees: EmployeeSummary[], extra: Partial<ExportContext> = {}): ExportContext {
  return {
    companyId: 1,
    companyName: 'Acme',
    periodStart: new Date('2026-04-13T00:00:00Z'),
    periodEnd: new Date('2026-04-27T00:00:00Z'),
    employees,
    ...extra,
  };
}

const lines = (csv: string) => csv.trim().split(/\r?\n/);

describe('payroll exports — time off', () => {
  it('Gusto fills PTO and holiday from paid time off; unpaid is left out', () => {
    const [, row] = lines(gusto(ctx([employee()])));
    expect(row).toBe('Ada,Lovelace,ada@example.test,30.00,0.00,0.00,8.00,8.00,0.00');
  });

  it('Payroll Relief appends time-off columns after the original seven', () => {
    const [header, row] = lines(payrollRelief(ctx([employee()])));
    expect(header).toBe(
      'EmployeeID,LastName,FirstName,RegularHours,OvertimeHours,PeriodStart,PeriodEnd,PTOHours,SickHours,HolidayHours,OtherPaidLeaveHours',
    );
    expect(row).toBe('E1,Lovelace,Ada,30.00,0.00,2026-04-13,2026-04-27,8.00,0.00,8.00,0.00');
  });

  it('QBO gets one row per paid time-off code, none for unpaid leave', () => {
    const rows = lines(qboPayroll(ctx([employee()]))).slice(1);
    expect(rows.map((r) => r.split(',')[2])).toEqual(['PTO', 'HOLIDAY', '']);
    expect(rows[0]).toContain(',8.00,0.00,');
  });

  it('an employee with only time off is still exported', () => {
    const e = employee({ regularSeconds: 0, workSeconds: 0 });
    expect(lines(gusto(ctx([e])))).toHaveLength(2);
    // QBO: only the time-off rows, no empty worked row.
    expect(lines(qboPayroll(ctx([e]))).slice(1)).toHaveLength(2);
  });

  it('generic CSV keeps total_hours as worked time and adds the time-off columns', () => {
    const csv = genericCsv(
      ctx([employee()], {
        genericColumns: ['total_hours', 'pto_hours', 'unpaid_hours', 'total_paid_hours'],
      }),
    );
    expect(lines(csv)[1]).toBe('30.00,8.00,4.00,46.00');
  });
});
