// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeEntry } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { DeleteEntryConfirm } from '../components/DeleteEntryConfirm';
import { EntryFormModal, type EntryFormValues } from '../components/EntryFormModal';
import { MissingTimeRemindersModal } from '../components/MissingTimeRemindersModal';
import { NLCorrectionWidget } from '../components/NLCorrectionWidget';
import { TimesheetView } from '../components/TimesheetView';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { employees, jobs as jobsApi, timesheets } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

/**
 * Manager/admin view — pick an employee, inspect their current-period
 * timesheet, approve or unapprove the period. Auto-closed + open entries
 * stand out in the list via the badges the TimesheetView renders.
 */
export function TimesheetsReviewPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();
  const session = useSession();
  const isAdmin =
    session?.user.roleGlobal === 'super_admin' ||
    session?.user.memberships.some((m) => m.companyId === companyId && m.role === 'company_admin');
  const navigate = useNavigate();

  const roster = useQuery({
    queryKey: ['employees', companyId, ''],
    queryFn: () => employees.list(companyId),
  });

  const activeRoster = useMemo(
    () => (roster.data ?? []).filter((e) => e.status === 'active'),
    [roster.data],
  );
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const effectiveId = selectedId ?? activeRoster[0]?.id ?? null;

  // Which pay period to show: `?at=<ISO instant>` picks the period that
  // contains it; absent = the current one. Kept in the URL so a reload or
  // a shared link stays on the same week, and switching employees keeps it.
  const [search, setSearch] = useSearchParams();
  const at = search.get('at') ?? undefined;
  const goToPeriodContaining = (instant: Date | null) => {
    const next = new URLSearchParams(search);
    if (instant) next.set('at', instant.toISOString());
    else next.delete('at');
    setSearch(next);
  };

  const sheet = useQuery({
    queryKey: ['timesheet', companyId, effectiveId, at ?? 'current'],
    queryFn: () => timesheets.get(companyId, effectiveId!, at ? { at } : {}),
    enabled: effectiveId != null,
    // While the next week loads, keep this employee's last sheet on screen
    // instead of flashing "Loading…" — but never another employee's.
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[2] === effectiveId ? prev : undefined,
  });

  const approve = useMutation({
    mutationFn: () =>
      timesheets.approve(companyId, {
        employeeIds: [effectiveId!],
        periodStart: sheet.data!.period.start,
        periodEnd: sheet.data!.period.end,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheet', companyId, effectiveId] }),
  });

  const unapprove = useMutation({
    mutationFn: () =>
      timesheets.unapprove(companyId, {
        employeeIds: [effectiveId!],
        periodStart: sheet.data!.period.start,
        periodEnd: sheet.data!.period.end,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheet', companyId, effectiveId] }),
  });

  // Jobs for the job dropdown in the entry form.
  const jobsQuery = useQuery({
    queryKey: ['jobs', companyId],
    queryFn: () => jobsApi.list(companyId),
  });
  const activeJobs = useMemo(
    () => (jobsQuery.data ?? []).filter((j) => !j.archivedAt),
    [jobsQuery.data],
  );

  const invalidateSheet = () =>
    qc.invalidateQueries({ queryKey: ['timesheet', companyId, effectiveId] });

  // Dialog state — exactly one modal can be open at a time.
  const [editTarget, setEditTarget] = useState<TimeEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TimeEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [missingOpen, setMissingOpen] = useState(false);

  const createEntry = useMutation({
    mutationFn: (values: EntryFormValues) => {
      if (!effectiveId) throw new Error('no employee selected');
      if (!values.endedAt) throw new Error('endedAt required for new entries');
      return timesheets.createEntry(companyId, {
        employeeId: effectiveId,
        startedAt: values.startedAt,
        endedAt: values.endedAt,
        entryType: values.entryType,
        jobId: values.jobId,
        reason: values.reason,
      });
    },
    onSuccess: () => {
      setAddOpen(false);
      invalidateSheet();
    },
  });

  const editEntry = useMutation({
    mutationFn: (values: EntryFormValues) => {
      if (!editTarget) throw new Error('no entry selected');
      return timesheets.editEntry(companyId, editTarget.id, {
        startedAt: values.startedAt,
        endedAt: values.endedAt,
        entryType: values.entryType,
        jobId: values.jobId,
        reason: values.reason,
      });
    },
    onSuccess: () => {
      setEditTarget(null);
      invalidateSheet();
    },
  });

  const deleteEntry = useMutation({
    mutationFn: (reason: string) => {
      if (!deleteTarget) throw new Error('no entry selected');
      return timesheets.deleteEntry(companyId, deleteTarget.id, reason);
    },
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateSheet();
    },
  });

  const employeeName = sheet.data
    ? `${sheet.data.employee.firstName} ${sheet.data.employee.lastName}`
    : '';

  // Exception flags surfaced on the employee list for quick triage.
  const exceptionIdsForEmployee = (employeeId: number): boolean => {
    if (sheet.data?.employee.id !== employeeId || !sheet.data) return false;
    return sheet.data.entries.some((e) => e.isAutoClosed || e.endedAt === null);
  };

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Employees</h2>
        {roster.isPending && <p className="text-xs text-slate-500">Loading…</p>}
        <ul className="flex flex-col gap-1">
          {activeRoster.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSelectedId(e.id)}
                className={
                  'flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ' +
                  (effectiveId === e.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                <span>
                  {e.lastName}, {e.firstName}
                </span>
                {exceptionIdsForEmployee(e.id) && (
                  <span
                    className={
                      'ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
                      (effectiveId === e.id
                        ? 'bg-amber-300 text-slate-900'
                        : 'bg-amber-100 text-amber-800')
                    }
                  >
                    exception
                  </span>
                )}
              </button>
            </li>
          ))}
          {activeRoster.length === 0 && !roster.isPending && (
            <li className="px-3 py-4 text-xs text-slate-500">No active employees.</li>
          )}
        </ul>
      </aside>

      <section className="flex flex-col gap-4">
        {sheet.isPending && <p className="text-sm text-slate-500">Loading timesheet…</p>}
        {sheet.isError && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {sheet.error instanceof ApiError ? sheet.error.message : 'Failed to load timesheet.'}
          </p>
        )}
        {sheet.data && (
          <>
            <PeriodNav
              period={sheet.data.period}
              loading={sheet.isFetching}
              onGo={goToPeriodContaining}
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="secondary"
                title="Employees with work days that have no time, and reminders"
                onClick={() => setMissingOpen(true)}
              >
                Missing time
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate(`/companies/${companyId}/timesheets/grid`)}
              >
                All-employee grid
              </Button>
              <Button
                variant="secondary"
                onClick={() => navigate(`/companies/${companyId}/timesheets/${effectiveId}/week`)}
                disabled={effectiveId == null}
              >
                Weekly grid
              </Button>
              {!sheet.data.isApproved && (
                <Button variant="secondary" onClick={() => setAddOpen(true)}>
                  Add entry
                </Button>
              )}
              {sheet.data.isApproved ? (
                <Button
                  variant="secondary"
                  loading={unapprove.isPending}
                  onClick={() => {
                    if (confirm('Unapprove this period? Every entry becomes editable again.'))
                      unapprove.mutate();
                  }}
                >
                  Unapprove period
                </Button>
              ) : (
                <Button
                  loading={approve.isPending}
                  disabled={sheet.data.entries.length === 0}
                  onClick={() => {
                    if (confirm('Approve every closed entry in this period?')) approve.mutate();
                  }}
                >
                  Approve period
                </Button>
              )}
            </div>
            <TimesheetView
              data={sheet.data}
              onEditEntry={setEditTarget}
              onDeleteEntry={setDeleteTarget}
              allowApprovedChanges={!!isAdmin}
            />
            <NLCorrectionWidget
              companyId={companyId}
              employeeId={sheet.data.employee.id}
              periodStart={sheet.data.period.start}
              periodEnd={sheet.data.period.end}
              companyTimezone={sheet.data.companyTimezone}
              entries={sheet.data.entries}
              onApplied={() =>
                qc.invalidateQueries({ queryKey: ['timesheet', companyId, effectiveId] })
              }
            />
            {(approve.isError || unapprove.isError) && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Approval action failed.
              </div>
            )}

            {missingOpen && (
              <MissingTimeRemindersModal
                companyId={companyId}
                onClose={() => setMissingOpen(false)}
              />
            )}
            {addOpen && effectiveId != null && (
              <EntryFormModal
                target={{ mode: 'create', employeeName, employeeId: effectiveId }}
                jobs={activeJobs}
                onCancel={() => setAddOpen(false)}
                onSubmit={(values) => createEntry.mutate(values)}
                timezone={sheet.data.companyTimezone}
                pending={createEntry.isPending}
                error={
                  createEntry.error instanceof ApiError
                    ? createEntry.error.message
                    : createEntry.error
                      ? 'Failed to create entry'
                      : null
                }
              />
            )}
            {editTarget && (
              <EntryFormModal
                target={{ mode: 'edit', entry: editTarget, employeeName }}
                jobs={activeJobs}
                onCancel={() => setEditTarget(null)}
                onSubmit={(values) => editEntry.mutate(values)}
                timezone={sheet.data.companyTimezone}
                pending={editEntry.isPending}
                error={
                  editEntry.error instanceof ApiError
                    ? editEntry.error.message
                    : editEntry.error
                      ? 'Failed to save changes'
                      : null
                }
              />
            )}
            {deleteTarget && (
              <DeleteEntryConfirm
                entry={deleteTarget}
                employeeName={employeeName}
                onCancel={() => setDeleteTarget(null)}
                onConfirm={(reason) => deleteEntry.mutate(reason)}
                pending={deleteEntry.isPending}
                error={
                  deleteEntry.error instanceof ApiError
                    ? deleteEntry.error.message
                    : deleteEntry.error
                      ? 'Failed to delete entry'
                      : null
                }
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Previous / next pay period (a week for weekly payroll), with a way back
 * to the current one. Steps land inside the neighbouring period, so every
 * view is a whole pay period and Approve acts on exactly what is shown.
 */
function PeriodNav({
  period,
  loading,
  onGo,
}: {
  period: { start: string; end: string; type: 'weekly' | 'bi_weekly' | 'semi_monthly' | 'monthly' };
  loading: boolean;
  onGo: (instant: Date | null) => void;
}) {
  const start = new Date(period.start);
  const end = new Date(period.end); // exclusive
  const now = new Date();
  const isCurrent = start <= now && now < end;
  const unit = period.type === 'weekly' ? 'week' : 'period';
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <Button variant="secondary" onClick={() => onGo(new Date(start.getTime() - 1))}>
        ← Previous {unit}
      </Button>
      <div className="text-center text-sm">
        <span className="font-semibold text-slate-900">
          {fmt(start)} – {fmt(new Date(end.getTime() - 1))}
        </span>
        {isCurrent ? (
          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
            Current {unit}
          </span>
        ) : (
          <button
            type="button"
            className="ml-2 text-xs text-slate-600 underline hover:text-slate-900"
            onClick={() => onGo(null)}
          >
            Back to current {unit}
          </button>
        )}
        {loading && <span className="ml-2 text-xs text-slate-400">Loading…</span>}
      </div>
      <Button variant="secondary" onClick={() => onGo(end)} disabled={isCurrent}>
        Next {unit} →
      </Button>
    </div>
  );
}
