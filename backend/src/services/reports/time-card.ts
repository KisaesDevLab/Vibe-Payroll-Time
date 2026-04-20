import { buildTimesheetSummary, timeCardParamsSchema, type TimeCardParams } from '@vibept/shared';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from '../punch.js';
import type { ReportHandler } from './types.js';

export const timeCardReport: ReportHandler<typeof timeCardParamsSchema> = {
  name: 'time_card',
  label: 'Time card by employee',
  description: 'Every entry for one employee across one pay period, with daily and period totals.',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'type', label: 'Type', type: 'string' },
    { key: 'startedAt', label: 'Start', type: 'datetime' },
    { key: 'endedAt', label: 'End', type: 'datetime' },
    { key: 'durationSeconds', label: 'Duration (hrs)', type: 'hours' },
    { key: 'jobCode', label: 'Job code', type: 'string' },
    { key: 'source', label: 'Source', type: 'string' },
    { key: 'approved', label: 'Approved', type: 'boolean' },
    { key: 'autoClosed', label: 'Auto-closed', type: 'boolean' },
  ],
  paramFields: [
    { key: 'employeeId', label: 'Employee', type: 'companyScoped', required: true },
    { key: 'periodStart', label: 'Period start', type: 'date', required: true },
    { key: 'periodEnd', label: 'Period end', type: 'date', required: true },
  ],
  paramsSchema: timeCardParamsSchema,
  async *rows(companyId: number, params: TimeCardParams) {
    const employee = await db('employees')
      .where({ id: params.employeeId, company_id: companyId })
      .first<{ id: number }>();
    if (!employee) throw NotFound('Employee not found');

    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);

    const rows = await db<TimeEntryRow>('time_entries as t')
      .leftJoin('jobs as j', 'j.id', 't.job_id')
      .where({ 't.company_id': companyId, 't.employee_id': params.employeeId })
      .whereNull('t.deleted_at')
      .where(function () {
        this.whereNull('t.ended_at').orWhere('t.ended_at', '>', start);
      })
      .where('t.started_at', '<', end)
      .orderBy('t.started_at', 'asc')
      .select<Array<TimeEntryRow & { job_code: string | null }>>('t.*', 'j.code as job_code');

    for (const r of rows) {
      const entry = rowToTimeEntry(r);
      yield {
        date: entry.startedAt.slice(0, 10),
        type: entry.entryType,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        durationSeconds: entry.durationSeconds,
        jobCode: r.job_code ?? '',
        source: entry.source + (entry.sourceOffline ? ' (offline)' : ''),
        approved: !!entry.approvedAt,
        autoClosed: entry.isAutoClosed,
      };
    }

    // Trailing summary row — visually separated in the UI, included in CSV
    // so payroll processors get a total line.
    const company = await db('companies').where({ id: companyId }).first<{
      timezone: string;
      week_start_day: number;
    }>();
    const settings = await db('company_settings').where({ company_id: companyId }).first<{
      punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
      punch_rounding_grace_minutes: number;
    }>();

    if (company && settings) {
      const entries = rows.map((r) => {
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
        date: '',
        type: 'TOTAL',
        startedAt: null,
        endedAt: null,
        durationSeconds: summary.periodTotal.workSeconds,
        jobCode: '',
        source: `regular ${(summary.periodTotal.regularSeconds / 3600).toFixed(2)} · OT ${(summary.periodTotal.overtimeSeconds / 3600).toFixed(2)}`,
        approved: null,
        autoClosed: null,
      };
    }
  },
};
