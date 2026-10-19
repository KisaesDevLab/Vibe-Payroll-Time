// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import {
  TIME_OFF_CATEGORY_LABELS,
  hoursByJobParamsSchema,
  type HoursByJobParams,
  type TimeOffCategory,
} from '@vibept/shared';
import { db } from '../../db/knex.js';
import type { ReportHandler } from './types.js';

export const hoursByJobReport: ReportHandler<typeof hoursByJobParamsSchema> = {
  name: 'hours_by_job',
  label: 'Hours by job',
  description:
    'Hours summed per (employee × job) for the period. Unassigned entries land in a "No job" row; time-off codes (PTO, sick, …) are listed after each employee\'s worked jobs.',
  columns: [
    { key: 'employeeNumber', label: 'Employee #', type: 'string' },
    { key: 'lastName', label: 'Last name', type: 'string' },
    { key: 'firstName', label: 'First name', type: 'string' },
    { key: 'jobCode', label: 'Job code', type: 'string' },
    { key: 'jobName', label: 'Job name', type: 'string' },
    { key: 'kind', label: 'Type', type: 'string' },
    { key: 'workSeconds', label: 'Hours', type: 'hours' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'Period start', type: 'date', required: true },
    { key: 'periodEnd', label: 'Period end', type: 'date', required: true },
  ],
  paramsSchema: hoursByJobParamsSchema,
  async *rows(companyId: number, params: HoursByJobParams) {
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);

    // Aggregate in SQL — duration is stored in seconds on closed entries.
    // Open entries are ignored here; they land in the OT/approaching
    // report instead. Breaks excluded (entry_type = 'work').
    const rows = await db('time_entries as t')
      .join('employees as e', 'e.id', 't.employee_id')
      .leftJoin('jobs as j', 'j.id', 't.job_id')
      .where('t.company_id', companyId)
      .where('t.entry_type', 'work')
      .whereNull('t.deleted_at')
      .whereNotNull('t.ended_at')
      .where('t.started_at', '>=', start)
      .where('t.started_at', '<', end)
      .groupBy([
        'e.id',
        'e.last_name',
        'e.first_name',
        'e.employee_number',
        'j.id',
        'j.code',
        'j.name',
        'j.is_time_off',
        'j.time_off_category',
      ])
      .orderBy(['e.last_name', 'e.first_name'])
      .orderByRaw('COALESCE(j.is_time_off, false), j.code')
      .select<
        Array<{
          employee_id: number;
          first_name: string;
          last_name: string;
          employee_number: string | null;
          job_code: string | null;
          job_name: string | null;
          is_time_off: boolean | null;
          time_off_category: TimeOffCategory | null;
          total_seconds: string;
        }>
      >('e.id as employee_id', 'e.first_name', 'e.last_name', 'e.employee_number', 'j.code as job_code', 'j.name as job_name', 'j.is_time_off', 'j.time_off_category', db.raw('COALESCE(SUM(t.duration_seconds), 0) as total_seconds'));

    for (const r of rows) {
      yield {
        employeeNumber: r.employee_number ?? '',
        lastName: r.last_name,
        firstName: r.first_name,
        jobCode: r.job_code ?? '(none)',
        jobName: r.job_name ?? 'No job',
        kind:
          r.is_time_off && r.time_off_category
            ? `time off · ${TIME_OFF_CATEGORY_LABELS[r.time_off_category]}`
            : 'work',
        workSeconds: Number(r.total_seconds),
      };
    }
  },
};
