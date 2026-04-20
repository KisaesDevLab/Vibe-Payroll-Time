import type { PayrollFormat, PreflightEmployeeStatus, PreflightResponse } from '@vibept/shared';
import { buildTimesheetSummary } from '@vibept/shared';
import { db } from '../../db/knex.js';
import { NotFound } from '../../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from '../punch.js';

/**
 * A payroll export must start from a clean state:
 *   - every entry in the period for every active employee is approved;
 *   - no entry is still open;
 *   - no correction requests pending against any entry in the period.
 *
 * The endpoint surfaces which employees fail which check so the admin
 * can chase the specific problems down. A non-ready preflight does NOT
 * prevent an admin from forcing the export — but the UI warns loudly
 * and the run endpoint refuses unless `acknowledgeReExport` or an
 * explicit override flag is set (we gate on ready for now; override
 * path is a Phase 12 consideration with licensing).
 */
export async function runPreflight(
  companyId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<PreflightResponse> {
  const company = await db('companies')
    .where({ id: companyId })
    .first<{ id: number; timezone: string; week_start_day: number }>();
  if (!company) throw NotFound('Company not found');
  const settings = await db('company_settings').where({ company_id: companyId }).first<{
    punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
    punch_rounding_grace_minutes: number;
  }>();
  if (!settings) throw NotFound('Company settings not found');

  const employees = await db('employees')
    .where({ company_id: companyId, status: 'active' })
    .orderBy(['last_name', 'first_name'])
    .select<
      Array<{
        id: number;
        first_name: string;
        last_name: string;
      }>
    >('id', 'first_name', 'last_name');

  const entries = await db<TimeEntryRow>('time_entries')
    .where('company_id', companyId)
    .whereNull('deleted_at')
    .where(function () {
      this.whereNull('ended_at').orWhere('ended_at', '>', periodStart);
    })
    .where('started_at', '<', periodEnd)
    .select<TimeEntryRow[]>('*');

  const pendingCorrections = await db('correction_requests')
    .where({ company_id: companyId, status: 'pending' })
    .select<
      Array<{ employee_id: number; time_entry_id: number | null }>
    >('employee_id', 'time_entry_id');

  const pendingByEmployee = new Set(pendingCorrections.map((c) => c.employee_id));
  const entriesByEmployee = new Map<number, TimeEntryRow[]>();
  for (const e of entries) {
    const arr = entriesByEmployee.get(e.employee_id) ?? [];
    arr.push(e);
    entriesByEmployee.set(e.employee_id, arr);
  }

  const statuses: PreflightEmployeeStatus[] = [];
  let hasAnyOpen = false;
  let hasAnyUnapproved = false;
  let hasAnyPending = false;

  for (const emp of employees) {
    const empEntries = entriesByEmployee.get(emp.id) ?? [];
    const hasOpen = empEntries.some((e) => e.ended_at === null);
    const allApproved =
      empEntries.length === 0 ||
      empEntries.every((e) => e.ended_at !== null && e.approved_at !== null);
    const hasPending = pendingByEmployee.has(emp.id);

    if (hasOpen) hasAnyOpen = true;
    if (!allApproved) hasAnyUnapproved = true;
    if (hasPending) hasAnyPending = true;

    const summaryEntries = empEntries.map((e) => {
      const res = rowToTimeEntry(e);
      return {
        id: res.id,
        employeeId: res.employeeId,
        shiftId: res.shiftId,
        entryType: res.entryType,
        jobId: res.jobId,
        startedAt: res.startedAt,
        endedAt: res.endedAt,
      };
    });
    const summary = buildTimesheetSummary(summaryEntries, {
      timezone: company.timezone,
      weekStartDay: company.week_start_day,
      roundingMode: settings.punch_rounding_mode,
      roundingGraceMinutes: settings.punch_rounding_grace_minutes,
      periodStart,
      periodEnd,
    });

    statuses.push({
      employeeId: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      allApproved,
      hasOpenEntry: hasOpen,
      hasPendingCorrection: hasPending,
      workSeconds: summary.periodTotal.workSeconds,
    });
  }

  const blockingIssues: string[] = [];
  if (hasAnyOpen) blockingIssues.push('At least one employee has an open entry in the period.');
  if (hasAnyUnapproved)
    blockingIssues.push('At least one employee has entries that are not approved yet.');
  if (hasAnyPending)
    blockingIssues.push('Pending correction requests exist — resolve them before exporting.');

  const prior = await db('payroll_exports as p')
    .leftJoin('users as u', 'u.id', 'p.exported_by')
    .where({ 'p.company_id': companyId })
    .where('p.period_start', periodStart)
    .where('p.period_end', periodEnd)
    .orderBy('p.exported_at', 'desc')
    .select<
      Array<{
        id: number;
        format: PayrollFormat;
        exported_at: Date;
        email: string | null;
      }>
    >('p.id', 'p.format', 'p.exported_at', 'u.email as email');

  return {
    ready: blockingIssues.length === 0 && employees.length > 0,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    employees: statuses,
    blockingIssues,
    priorExports: prior.map((r) => ({
      id: r.id,
      format: r.format,
      exportedAt: r.exported_at.toISOString(),
      exportedBy: r.email,
    })),
  };
}

/** Build the per-employee payload the format functions consume. Shares
 *  computation with runPreflight — kept as a separate entry point so
 *  the engine can call it without re-running preflight cheks. */
export async function collectEmployeeSummaries(
  companyId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<import('./types.js').EmployeeSummary[]> {
  const company = await db('companies')
    .where({ id: companyId })
    .first<{ id: number; timezone: string; week_start_day: number }>();
  if (!company) throw NotFound('Company not found');
  const settings = await db('company_settings').where({ company_id: companyId }).first<{
    punch_rounding_mode: 'none' | '1min' | '5min' | '6min' | '15min';
    punch_rounding_grace_minutes: number;
  }>();
  if (!settings) throw NotFound('Company settings not found');

  const employees = await db('employees')
    .where({ company_id: companyId })
    .orderBy(['last_name', 'first_name'])
    .select<
      Array<{
        id: number;
        first_name: string;
        last_name: string;
        employee_number: string | null;
        email: string | null;
        status: 'active' | 'terminated';
      }>
    >('id', 'first_name', 'last_name', 'employee_number', 'email', 'status');

  const rows = await db<TimeEntryRow>('time_entries')
    .where('company_id', companyId)
    .whereNull('deleted_at')
    .where(function () {
      this.whereNull('ended_at').orWhere('ended_at', '>', periodStart);
    })
    .where('started_at', '<', periodEnd)
    .select<TimeEntryRow[]>('*');

  const jobs = await db('jobs')
    .where({ company_id: companyId })
    .select<Array<{ id: number; code: string }>>('id', 'code');
  const jobCode = new Map(jobs.map((j) => [j.id, j.code]));

  const byEmployee = new Map<number, TimeEntryRow[]>();
  for (const r of rows) {
    const arr = byEmployee.get(r.employee_id) ?? [];
    arr.push(r);
    byEmployee.set(r.employee_id, arr);
  }

  const out: import('./types.js').EmployeeSummary[] = [];
  for (const emp of employees) {
    const empRows = byEmployee.get(emp.id) ?? [];
    if (emp.status !== 'active' && empRows.length === 0) continue;

    const entries = empRows.map((r) => {
      const res = rowToTimeEntry(r);
      return {
        id: res.id,
        employeeId: res.employeeId,
        shiftId: res.shiftId,
        entryType: res.entryType,
        jobId: res.jobId,
        startedAt: res.startedAt,
        endedAt: res.endedAt,
      };
    });

    const summary = buildTimesheetSummary(entries, {
      timezone: company.timezone,
      weekStartDay: company.week_start_day,
      roundingMode: settings.punch_rounding_mode,
      roundingGraceMinutes: settings.punch_rounding_grace_minutes,
      periodStart,
      periodEnd,
    });

    out.push({
      employeeId: emp.id,
      employeeNumber: emp.employee_number,
      firstName: emp.first_name,
      lastName: emp.last_name,
      email: emp.email,
      regularSeconds: summary.periodTotal.regularSeconds,
      overtimeSeconds: summary.periodTotal.overtimeSeconds,
      breakSeconds: summary.periodTotal.breakSeconds,
      workSeconds: summary.periodTotal.workSeconds,
      byJob: summary.jobBreakdown.map((j: { jobId: number | null; workSeconds: number }) => ({
        jobId: j.jobId,
        jobCode: j.jobId != null ? (jobCode.get(j.jobId) ?? null) : null,
        workSeconds: j.workSeconds,
      })),
    });
  }

  return out;
}
