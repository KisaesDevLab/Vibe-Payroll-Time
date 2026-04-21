import { punchActivityParamsSchema, type PunchActivityParams } from '@vibept/shared';
import { db } from '../../db/knex.js';
import type { TimeEntryRow } from '../punch.js';
import type { ReportHandler } from './types.js';

/**
 * Punch activity — the investigation / review report.
 *
 * Complements `time_card` (which is the clean payroll deliverable for
 * one employee). This one is for supervisors hunting anomalies:
 *
 *   - every closed entry in a period, optionally narrowed by employee,
 *     source, approval state, or "exceptions only"
 *   - columns expose the network attribution (source_ip, UA prefix),
 *     device id, edit trail, and flag columns so rare-but-important
 *     punches surface visually
 *
 * Supervisors can use this to find "Joe punched from an IP nowhere
 * near the office", "this kiosk hasn't closed a shift properly in a
 * week", or "every punch supervisor X edited this period".
 */
type Row = TimeEntryRow & {
  first_name: string;
  last_name: string;
  job_code: string | null;
  editor_email: string | null;
};

export const punchActivityReport: ReportHandler<typeof punchActivityParamsSchema> = {
  name: 'punch_activity',
  label: 'Punch activity (investigation)',
  description:
    'Every entry in a period with network attribution, source device, and exception flags. Filters narrow to an employee, source, approval state, or only entries flagged as exceptions (auto-closed, offline, or edited).',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'employee', label: 'Employee', type: 'string' },
    { key: 'type', label: 'Type', type: 'string' },
    { key: 'startedAt', label: 'Start', type: 'datetime' },
    { key: 'endedAt', label: 'End', type: 'datetime' },
    { key: 'durationSeconds', label: 'Duration (hrs)', type: 'hours' },
    { key: 'jobCode', label: 'Job', type: 'string' },
    { key: 'source', label: 'Source', type: 'string' },
    { key: 'sourceDevice', label: 'Device', type: 'string' },
    { key: 'sourceIp', label: 'IP', type: 'string' },
    { key: 'userAgent', label: 'User agent', type: 'string' },
    { key: 'flags', label: 'Flags', type: 'string' },
    { key: 'approved', label: 'Approved', type: 'boolean' },
    { key: 'editedBy', label: 'Edited by', type: 'string' },
    { key: 'editReason', label: 'Edit reason', type: 'string' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'Period start', type: 'date', required: true },
    { key: 'periodEnd', label: 'Period end', type: 'date', required: true },
    { key: 'employeeId', label: 'Employee (optional)', type: 'companyScoped', required: false },
    {
      key: 'source',
      label: 'Source',
      type: 'enum',
      required: false,
      choices: [
        { value: 'all', label: 'All sources' },
        { value: 'kiosk', label: 'Kiosk only' },
        { value: 'web', label: 'Web only' },
        { value: 'mobile_pwa', label: 'Mobile PWA only' },
      ],
    },
    {
      key: 'approvedState',
      label: 'Approval state',
      type: 'enum',
      required: false,
      choices: [
        { value: 'all', label: 'All' },
        { value: 'approved', label: 'Approved only' },
        { value: 'pending', label: 'Pending only' },
      ],
    },
    {
      key: 'flag',
      label: 'Flag',
      type: 'enum',
      required: false,
      choices: [
        { value: 'all', label: 'All entries' },
        { value: 'exceptions_only', label: 'Exceptions only (auto-closed / offline / edited)' },
      ],
    },
  ],
  paramsSchema: punchActivityParamsSchema,
  async *rows(companyId: number, params: PunchActivityParams) {
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);

    const q = db<TimeEntryRow>('time_entries as t')
      .join('employees as e', 'e.id', 't.employee_id')
      .leftJoin('jobs as j', 'j.id', 't.job_id')
      .leftJoin('users as u', 'u.id', 't.edited_by')
      .where({ 't.company_id': companyId })
      .whereNull('t.deleted_at')
      // Overlap with the period, same window logic as time-card.
      .where(function () {
        this.whereNull('t.ended_at').orWhere('t.ended_at', '>', start);
      })
      .where('t.started_at', '<', end);

    if (params.employeeId) {
      q.where('t.employee_id', params.employeeId);
    }
    if (params.source && params.source !== 'all') {
      q.where('t.source', params.source);
    }
    if (params.approvedState === 'approved') {
      q.whereNotNull('t.approved_at');
    } else if (params.approvedState === 'pending') {
      q.whereNull('t.approved_at');
    }
    if (params.flag === 'exceptions_only') {
      q.where(function () {
        this.where('t.is_auto_closed', true)
          .orWhere('t.source_offline', true)
          .orWhereNotNull('t.edit_reason');
      });
    }

    const rows = await q
      .orderBy('t.started_at', 'asc')
      .select<
        Row[]
      >('t.*', 'e.first_name as first_name', 'e.last_name as last_name', 'j.code as job_code', 'u.email as editor_email');

    for (const r of rows) {
      const flags: string[] = [];
      if (r.is_auto_closed) flags.push('auto-closed');
      if (r.source_offline) flags.push('offline');
      if (r.edit_reason) flags.push('edited');
      // Admin-created rows use the `web-admin-<userId>` device id convention.
      if (r.source === 'web' && r.source_device_id?.startsWith('web-admin-')) {
        flags.push('admin-created');
      }

      yield {
        date: r.started_at.toISOString().slice(0, 10),
        employee: `${r.last_name}, ${r.first_name}`,
        type: r.entry_type,
        startedAt: r.started_at.toISOString(),
        endedAt: r.ended_at?.toISOString() ?? null,
        durationSeconds: r.duration_seconds == null ? null : Number(r.duration_seconds),
        jobCode: r.job_code ?? '',
        source: r.source,
        sourceDevice: r.source_device_id ?? '',
        sourceIp: r.source_ip ?? '',
        // Truncate UA in the report — full value is in the DB if anyone
        // needs it via SQL.
        userAgent: r.source_user_agent ? r.source_user_agent.slice(0, 80) : '',
        flags: flags.join(', '),
        approved: !!r.approved_at,
        editedBy: r.editor_email ?? '',
        editReason: r.edit_reason ?? '',
      };
    }
  },
};
