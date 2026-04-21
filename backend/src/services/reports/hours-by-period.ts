// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import {
  buildTimesheetSummary,
  hoursByPeriodParamsSchema,
  type HoursByPeriodParams,
} from '@vibept/shared';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from '../punch.js';
import type { ReportHandler } from './types.js';

export const hoursByPeriodReport: ReportHandler<typeof hoursByPeriodParamsSchema> = {
  name: 'hours_by_period',
  label: 'Hours by pay period',
  description:
    'One row per active employee with regular, overtime, break, and total hours for the period.',
  columns: [
    { key: 'employeeNumber', label: 'Employee #', type: 'string' },
    { key: 'lastName', label: 'Last name', type: 'string' },
    { key: 'firstName', label: 'First name', type: 'string' },
    { key: 'regularSeconds', label: 'Regular hrs', type: 'hours' },
    { key: 'overtimeSeconds', label: 'OT hrs', type: 'hours' },
    { key: 'breakSeconds', label: 'Break hrs', type: 'hours' },
    { key: 'workSeconds', label: 'Total hrs', type: 'hours' },
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
          status: 'active' | 'terminated';
        }>
      >('id', 'first_name', 'last_name', 'employee_number', 'status');

    const byEmployee = new Map<number, TimeEntryRow[]>();
    for (const r of rows) {
      const arr = byEmployee.get(r.employee_id) ?? [];
      arr.push(r);
      byEmployee.set(r.employee_id, arr);
    }

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
      });

      yield {
        employeeNumber: emp.employee_number ?? '',
        lastName: emp.last_name,
        firstName: emp.first_name,
        regularSeconds: summary.periodTotal.regularSeconds,
        overtimeSeconds: summary.periodTotal.overtimeSeconds,
        breakSeconds: summary.periodTotal.breakSeconds,
        workSeconds: summary.periodTotal.workSeconds,
      };
    }
  },
};
