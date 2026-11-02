// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import {
  buildTimesheetSummary,
  hoursByPeriodParamsSchema,
  type HoursByPeriodParams,
} from '@vibept/shared';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from '../punch.js';
import { loadTimeOffJobs } from '../time-off.js';
import type { ReportHandler } from './types.js';

/** The hours columns the TOTAL row sums. */
const TOTALLED = [
  'regularSeconds',
  'overtimeSeconds',
  'breakSeconds',
  'workSeconds',
  'ptoSeconds',
  'sickSeconds',
  'holidaySeconds',
  'otherTimeOffSeconds',
  'unpaidSeconds',
  'paidTotalSeconds',
] as const;

type Totals = Record<(typeof TOTALLED)[number], number>;
type EmployeeRow = Totals & {
  department: string;
  employeeNumber: string;
  lastName: string;
  firstName: string;
};

const emptyTotals = (): Totals => Object.fromEntries(TOTALLED.map((k) => [k, 0])) as Totals;
const addInto = (into: Totals, row: Totals) => {
  for (const key of TOTALLED) into[key] += row[key];
};
const countLabel = (n: number) => `${n} employee${n === 1 ? '' : 's'}`;

export const hoursByPeriodReport: ReportHandler<typeof hoursByPeriodParamsSchema> = {
  name: 'hours_by_period',
  label: 'Hours by pay period',
  description:
    'One row per active employee with regular, overtime, break and worked hours for the period, plus time off by type, subtotalled by department with a grand total. Overtime is computed on worked hours only.',
  columns: [
    { key: 'department', label: 'Department', type: 'string' },
    { key: 'employeeNumber', label: 'Employee #', type: 'string' },
    { key: 'lastName', label: 'Last name', type: 'string' },
    { key: 'firstName', label: 'First name', type: 'string' },
    { key: 'regularSeconds', label: 'Regular hrs', type: 'hours' },
    { key: 'overtimeSeconds', label: 'OT hrs', type: 'hours' },
    { key: 'breakSeconds', label: 'Break hrs', type: 'hours' },
    { key: 'workSeconds', label: 'Worked hrs', type: 'hours' },
    { key: 'ptoSeconds', label: 'PTO hrs', type: 'hours' },
    { key: 'sickSeconds', label: 'Sick hrs', type: 'hours' },
    { key: 'holidaySeconds', label: 'Holiday hrs', type: 'hours' },
    { key: 'otherTimeOffSeconds', label: 'Other time off hrs', type: 'hours' },
    { key: 'unpaidSeconds', label: 'Unpaid leave hrs', type: 'hours' },
    { key: 'paidTotalSeconds', label: 'Paid total hrs', type: 'hours' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'Period start', type: 'date', required: true },
    { key: 'periodEnd', label: 'Period end', type: 'date', required: true },
  ],
  paramsSchema: hoursByPeriodParamsSchema,
  async *rows(companyId: number, params: HoursByPeriodParams) {
    const company = await db('companies')
      .where({ id: companyId })
      .first<{ timezone: string; week_start_day: number }>();
    if (!company) throw NotFound('Company not found');
    const settings = await db('company_settings').where({ company_id: companyId }).first<{
      punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
      punch_rounding_grace_minutes: number;
    }>();
    if (!settings) throw NotFound('Company settings not found');

    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);

    // Pull all entries for the period in one go, then group by employee
    // in memory. For companies with thousands of employees × thousands of
    // entries this is still well under 100 MB; we can stream later if
    // needed.
    const rows = await db<TimeEntryRow>('time_entries')
      .where('company_id', companyId)
      .whereNull('deleted_at')
      .whereNull('superseded_by_entry_id') // replaced by a manual entry
      .where(function () {
        this.whereNull('ended_at').orWhere('ended_at', '>', start);
      })
      .where('started_at', '<', end)
      .select<TimeEntryRow[]>('*');

    const employees = await db('employees')
      .where({ company_id: companyId })
      .orderBy(['last_name', 'first_name'])
      .select<
        Array<{
          id: number;
          first_name: string;
          last_name: string;
          employee_number: string | null;
          department: string | null;
          status: 'active' | 'terminated';
        }>
      >('id', 'first_name', 'last_name', 'employee_number', 'department', 'status');

    const timeOffJobs = await loadTimeOffJobs(companyId);
    const byEmployee = new Map<number, TimeEntryRow[]>();
    for (const r of rows) {
      const arr = byEmployee.get(r.employee_id) ?? [];
      arr.push(r);
      byEmployee.set(r.employee_id, arr);
    }

    // Rows grouped by department, compared case-insensitively so "Tax"
    // and "tax " land together; the first spelling seen names the group.
    const groups = new Map<string, { name: string | null; rows: EmployeeRow[] }>();

    for (const emp of employees) {
      const empRows = byEmployee.get(emp.id) ?? [];
      // Terminated employees only appear if they had activity in the period.
      if (emp.status !== 'active' && empRows.length === 0) continue;

      const entries = empRows.map((r) => {
        const e = rowToTimeEntry(r);
        return {
          id: e.id,
          employeeId: e.employeeId,
          shiftId: e.shiftId,
          entryType: e.entryType,
          jobId: e.jobId,
          startedAt: e.startedAt,
          endedAt: e.endedAt,
        };
      });

      const summary = buildTimesheetSummary(entries, {
        timezone: company.timezone,
        weekStartDay: company.week_start_day,
        roundingMode: settings.punch_rounding_mode,
        roundingGraceMinutes: settings.punch_rounding_grace_minutes,
        periodStart: start,
        periodEnd: end,
        timeOffJobs,
      });

      const department = emp.department?.trim() || null;
      const row: EmployeeRow = {
        department: department ?? '',
        employeeNumber: emp.employee_number ?? '',
        lastName: emp.last_name,
        firstName: emp.first_name,
        regularSeconds: summary.periodTotal.regularSeconds,
        overtimeSeconds: summary.periodTotal.overtimeSeconds,
        breakSeconds: summary.periodTotal.breakSeconds,
        workSeconds: summary.periodTotal.workSeconds,
        ptoSeconds: summary.timeOff.byCategory.pto,
        sickSeconds: summary.timeOff.byCategory.sick,
        holidaySeconds: summary.timeOff.byCategory.holiday,
        otherTimeOffSeconds: summary.timeOff.byCategory.other,
        unpaidSeconds: summary.timeOff.unpaidSeconds,
        paidTotalSeconds: summary.periodTotal.workSeconds + summary.timeOff.paidSeconds,
      };
      const key = department?.toLowerCase() ?? '';
      const group = groups.get(key) ?? { name: department, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }

    // Departments A–Z, "No department" last. Subtotals appear only when
    // someone has a department; otherwise the report is a plain list with
    // the grand total. Every total sums the per-employee figures, so
    // overtime stays per-person (never recomputed on combined hours).
    // Total rows render bold in the UI and PDF and are in the CSV.
    const ordered = [...groups.entries()].sort(([a], [b]) =>
      a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
    );
    const byDepartment = ordered.some(([key]) => key !== '');
    const grand = emptyTotals();
    let employeeCount = 0;

    for (const [, group] of ordered) {
      const subtotal = emptyTotals();
      for (const row of group.rows) {
        addInto(subtotal, row);
        addInto(grand, row);
        yield row;
      }
      employeeCount += group.rows.length;
      if (byDepartment) {
        yield {
          department: group.name ?? 'No department',
          employeeNumber: '',
          lastName: 'SUBTOTAL',
          firstName: countLabel(group.rows.length),
          ...subtotal,
        };
      }
    }

    if (employeeCount > 0) {
      yield {
        department: '',
        employeeNumber: '',
        lastName: 'TOTAL',
        firstName: countLabel(employeeCount),
        ...grand,
      };
    }
  },
};
