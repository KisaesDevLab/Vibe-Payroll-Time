import { auditTrailParamsSchema, type AuditTrailParams } from '@vibept/shared';
import { db } from '../../db/knex.js';
import type { ReportHandler } from './types.js';

export const auditTrailReport: ReportHandler<typeof auditTrailParamsSchema> = {
  name: 'audit_trail',
  label: 'Audit trail',
  description:
    'Every time_entry_audit row for the company in the given range, optionally filtered by action or actor.',
  columns: [
    { key: 'createdAt', label: 'When', type: 'datetime' },
    { key: 'action', label: 'Action', type: 'string' },
    { key: 'entryId', label: 'Entry #', type: 'number' },
    { key: 'employeeId', label: 'Employee #', type: 'number' },
    { key: 'actorEmail', label: 'Actor', type: 'string' },
    { key: 'field', label: 'Field', type: 'string' },
    { key: 'oldValue', label: 'Old', type: 'string' },
    { key: 'newValue', label: 'New', type: 'string' },
    { key: 'reason', label: 'Reason', type: 'string' },
  ],
  paramFields: [
    { key: 'periodStart', label: 'From', type: 'date', required: true },
    { key: 'periodEnd', label: 'To', type: 'date', required: true },
  ],
  paramsSchema: auditTrailParamsSchema,
  async *rows(companyId: number, params: AuditTrailParams) {
    const start = new Date(params.periodStart);
    const end = new Date(params.periodEnd);

    const q = db('time_entry_audit as a')
      .leftJoin('users as u', 'u.id', 'a.actor_user_id')
      .join('time_entries as t', 't.id', 'a.time_entry_id')
      .where('a.company_id', companyId)
      .where('a.created_at', '>=', start)
      .where('a.created_at', '<', end)
      .orderBy('a.created_at', 'asc');

    if (params.action) q.where('a.action', params.action);
    if (params.actorUserId) q.where('a.actor_user_id', params.actorUserId);

    // Avoid buffering all rows in memory — stream from the cursor.
    const stream = q
      .select(
        'a.created_at',
        'a.action',
        'a.time_entry_id',
        't.employee_id',
        'u.email as actor_email',
        'a.field',
        'a.old_value',
        'a.new_value',
        'a.reason',
      )
      .stream();

    for await (const r of stream as AsyncIterable<{
      created_at: Date;
      action: string;
      time_entry_id: number;
      employee_id: number;
      actor_email: string | null;
      field: string | null;
      old_value: unknown;
      new_value: unknown;
      reason: string | null;
    }>) {
      yield {
        createdAt: r.created_at,
        action: r.action,
        entryId: r.time_entry_id,
        employeeId: r.employee_id,
        actorEmail: r.actor_email ?? 'system',
        field: r.field ?? '',
        oldValue: stringify(r.old_value),
        newValue: stringify(r.new_value),
        reason: r.reason ?? '',
      };
    }
  },
};

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
