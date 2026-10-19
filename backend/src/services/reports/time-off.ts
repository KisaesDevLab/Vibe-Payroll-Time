// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import {
  TIME_OFF_CATEGORY_LABELS,
  buildTimesheetSummary,
  isoDateInTz,
  timeOffEntriesParamsSchema,
  timeOffSummaryParamsSchema,
  type TimeOffCategory,
  type TimeOffEntriesParams,
  type TimeOffSummaryParams,
} from '@vibept/shared';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import type { TimeEntryRow } from '../punch.js';
import { loadTimeOffJobs } from '../time-off.js';
import type { ReportHandler } from './types.js';

/**
 * Time-off reports. Vibe PT records time off; it does not track
 * balances, so these say what was USED in a period, never what is left.
 *
 *   time_off_summary  one row per employee with hours by type: the
 *                     year-end "how much PTO did everyone take" sheet.
 *   time_off_entries  every time-off entry, with who entered it and
 *                     whether it is approved, for review and audit.
 */

async function loadCompany(companyId: number) {
  const company = await db('companies')
    .where({ id: companyId })
    .first<{ timezone: string; week_start_day: number }>();
  if (!company) throw NotFound('Company not found');
  return company;
}

/** Live (not deleted, not superseded) entries on time-off codes. */
function timeOffEntriesQuery(companyId: number, start: Date, end: Date) {
  return db('time_entries as t')
    .join('jobs as j', 'j.id', 't.job_id')
    .where('t.company_id', companyId)
    .where('j.is_time_off', true)
    .where('t.entry_type', 'work')
    .whereNull('t.deleted_at')
    .whereNull('t.superseded_by_entry_id')
    .where('t.started_at', '>=', start)
    .where('t.started_at', '<', end);
}

export const timeOffSummaryReport: ReportHandler<typeof timeOffSummaryParamsSchema> = {
  name: 'time_off_summary',
  label: 'Time off by period',
  description:
    'Hours of time off each employee used in the period, by type (PTO, sick, holiday, other, unpaid). Usage only: Vibe PT does not track balances or accruals.',
  columns: [
    { key: 'employeeNumber', label: 'Employee #', type: 'string' },
    { key: 'lastName', label: 'Last name', type: 'string' },
    { key: 'firstName', label: 'First name', type: 'string' },
    { key: 'ptoSeconds', label: 'PTO hrs', type: 'hours' },
    { key: 'sickSeconds', label: 'Sick hrs', type: 'hours' },
    { key: 'holidaySeconds', label: 'Holiday hrs', type: 'hours' },
    { key: 'otherSeconds', label: 'Other hrs', type: 'hours' },
    { key: 'paidSeconds', label: 'Paid time off hrs', type: 'hours' },
    { key: 'unpaidSeconds', label: 'Unpaid leave hrs', type: 'hours' },
    { key: 'totalSeconds', label: 'All time off hrs', type: 'hours' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'Period start', type: 'date', required: true },
    { key: 'periodEnd', label: 'Period end', type: 'date', required: true },
  ],
  paramsSchema: timeOffSummaryParamsSchema,
  async *rows(companyId: number, params: TimeOffSummaryParams) {
    const company = await loadCompany(companyId);
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);
    const timeOffJobs = await loadTimeOffJobs(companyId);
    if (timeOffJobs.size === 0) return;

    const rows = await timeOffEntriesQuery(companyId, start, end).select<TimeEntryRow[]>('t.*');
    const byEmployee = new Map<number, TimeEntryRow[]>();
    for (const r of rows) {
      const arr = byEmployee.get(r.employee_id) ?? [];
      arr.push(r);
      byEmployee.set(r.employee_id, arr);
    }
    if (byEmployee.size === 0) return;

    const employees = await db('employees')
      .where({ company_id: companyId })
      .whereIn('id', [...byEmployee.keys()])
      .orderBy(['last_name', 'first_name'])
      .select<
        Array<{
          id: number;
          first_name: string;
          last_name: string;
          employee_number: string | null;
        }>
      >('id', 'first_name', 'last_name', 'employee_number');

    for (const emp of employees) {
      // Same math as timesheets and exports, so the numbers agree.
      const summary = buildTimesheetSummary(
        (byEmployee.get(emp.id) ?? []).map((r) => ({
          id: r.id,
          employeeId: r.employee_id,
          shiftId: r.shift_id,
          entryType: r.entry_type,
          jobId: r.job_id,
          startedAt: r.started_at,
          endedAt: r.ended_at,
        })),
        {
          timezone: company.timezone,
          weekStartDay: company.week_start_day,
          roundingMode: 'none',
          roundingGraceMinutes: 0,
          periodStart: start,
          periodEnd: end,
          timeOffJobs,
        },
      );
      const t = summary.timeOff;
      yield {
        employeeNumber: emp.employee_number ?? '',
        lastName: emp.last_name,
        firstName: emp.first_name,
        ptoSeconds: t.byCategory.pto,
        sickSeconds: t.byCategory.sick,
        holidaySeconds: t.byCategory.holiday,
        otherSeconds: t.byCategory.other,
        paidSeconds: t.paidSeconds,
        unpaidSeconds: t.unpaidSeconds,
        totalSeconds: t.totalSeconds,
      };
    }
  },
};

export const timeOffEntriesReport: ReportHandler<typeof timeOffEntriesParamsSchema> = {
  name: 'time_off_entries',
  label: 'Time off entries',
  description:
    'Every time-off entry in the period: who, which day, which type, how many hours, who entered it, and whether it is approved.',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'employee', label: 'Employee', type: 'string' },
    { key: 'category', label: 'Type', type: 'string' },
    { key: 'jobCode', label: 'Code', type: 'string' },
    { key: 'durationSeconds', label: 'Hours', type: 'hours' },
    { key: 'paid', label: 'Paid', type: 'boolean' },
    { key: 'approved', label: 'Approved', type: 'boolean' },
    { key: 'enteredBy', label: 'Entered by', type: 'string' },
    { key: 'reason', label: 'Note', type: 'string' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'Period start', type: 'date', required: true },
    { key: 'periodEnd', label: 'Period end', type: 'date', required: true },
    { key: 'employeeId', label: 'Employee (optional)', type: 'companyScoped', required: false },
    {
      key: 'category',
      label: 'Type',
      type: 'enum',
      required: false,
      choices: [
        { value: 'all', label: 'All types' },
        ...(Object.entries(TIME_OFF_CATEGORY_LABELS) as Array<[TimeOffCategory, string]>).map(
          ([value, label]) => ({ value, label }),
        ),
      ],
    },
  ],
  paramsSchema: timeOffEntriesParamsSchema,
  async *rows(companyId: number, params: TimeOffEntriesParams) {
    const company = await loadCompany(companyId);
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);

    const q = timeOffEntriesQuery(companyId, start, end)
      .join('employees as e', 'e.id', 't.employee_id')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .orderBy([
        { column: 't.started_at', order: 'asc' },
        { column: 'e.last_name', order: 'asc' },
      ]);
    if (params.employeeId) q.where('t.employee_id', params.employeeId);
    if (params.category && params.category !== 'all') {
      q.where('j.time_off_category', params.category);
    }
    const rows = await q.select<
      Array<{
        started_at: Date;
        duration_seconds: string | number | null;
        approved_at: Date | null;
        entry_reason: string | null;
        first_name: string;
        last_name: string;
        code: string;
        time_off_category: TimeOffCategory;
        is_paid: boolean;
        creator_email: string | null;
      }>
    >(
      't.started_at',
      't.duration_seconds',
      't.approved_at',
      't.entry_reason',
      'e.first_name',
      'e.last_name',
      'j.code',
      'j.time_off_category',
      'j.is_paid',
      'u.email as creator_email',
    );

    for (const r of rows) {
      yield {
        // Time off is stored from local midnight, so the civil date in
        // the company's timezone is the day it was taken.
        date: isoDateInTz(new Date(r.started_at), company.timezone),
        employee: `${r.last_name}, ${r.first_name}`,
        category: TIME_OFF_CATEGORY_LABELS[r.time_off_category] ?? r.time_off_category,
        jobCode: r.code,
        durationSeconds: r.duration_seconds == null ? 0 : Number(r.duration_seconds),
        paid: r.is_paid,
        approved: !!r.approved_at,
        enteredBy: r.creator_email ?? '',
        reason: r.entry_reason === 'Time off' ? '' : (r.entry_reason ?? ''),
      };
    }
  },
};
