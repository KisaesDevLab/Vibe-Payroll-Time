import {
  buildTimesheetSummary,
  overtimeParamsSchema,
  resolveWorkWeek,
  type OvertimeParams,
} from '@vibept/shared';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from '../punch.js';
import type { ReportHandler } from './types.js';

export const overtimeReport: ReportHandler<typeof overtimeParamsSchema> = {
  name: 'overtime',
  label: 'Overtime & approaching-OT',
  description:
    'Employees running over 40 hours this work week, or above an "approaching" threshold (default 35).',
  columns: [
    { key: 'employeeNumber', label: 'Employee #', type: 'string' },
    { key: 'lastName', label: 'Last name', type: 'string' },
    { key: 'firstName', label: 'First name', type: 'string' },
    { key: 'weekStart', label: 'Week start', type: 'date' },
    { key: 'workSeconds', label: 'Hours this week', type: 'hours' },
    { key: 'overtimeSeconds', label: 'OT hours', type: 'hours' },
    { key: 'status', label: 'Flag', type: 'string' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'Reference date', type: 'date', required: false },
  ],
  paramsSchema: overtimeParamsSchema,
  async *rows(companyId: number, params: OvertimeParams) {
    const company = await db('companies')
      .where({ id: companyId })
      .first<{ timezone: string; week_start_day: number }>();
    if (!company) throw NotFound('Company not found');
    const settings = await db('company_settings')
      .where({ company_id: companyId })
      .first<{
        punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
        punch_rounding_grace_minutes: number;
      }>();
    if (!settings) throw NotFound('Company settings not found');

    const reference = params.referenceDate ? new Date(params.referenceDate) : new Date();
    const approachingSeconds = (params.approachingThreshold ?? 35) * 3600;

    const { start, end } = resolveWorkWeek(reference, {
      weekStartDay: company.week_start_day,
      timezone: company.timezone,
    });

    const rows = await db<TimeEntryRow>('time_entries')
      .where('company_id', companyId)
      .whereNull('deleted_at')
      .where(function () {
        this.whereNull('ended_at').orWhere('ended_at', '>', start);
      })
      .where('started_at', '<', end)
      .select<TimeEntryRow[]>('*');

    const employees = await db('employees')
      .where({ company_id: companyId, status: 'active' })
      .orderBy(['last_name', 'first_name'])
      .select<
        Array<{
          id: number;
          first_name: string;
          last_name: string;
          employee_number: string | null;
        }>
      >('id', 'first_name', 'last_name', 'employee_number');

    const byEmployee = new Map<number, TimeEntryRow[]>();
    for (const r of rows) {
      const arr = byEmployee.get(r.employee_id) ?? [];
      arr.push(r);
      byEmployee.set(r.employee_id, arr);
    }

    for (const emp of employees) {
      const empRows = byEmployee.get(emp.id) ?? [];
      if (empRows.length === 0) continue;

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

      const work = summary.periodTotal.workSeconds;
      const ot = summary.periodTotal.overtimeSeconds;
      let flag: 'overtime' | 'approaching' | null = null;
      if (ot > 0) flag = 'overtime';
      else if (work >= approachingSeconds) flag = 'approaching';
      if (!flag) continue;

      yield {
        employeeNumber: emp.employee_number ?? '',
        lastName: emp.last_name,
        firstName: emp.first_name,
        weekStart: start.toISOString().slice(0, 10),
        workSeconds: work,
        overtimeSeconds: ot,
        status: flag,
      };
    }
  },
};
