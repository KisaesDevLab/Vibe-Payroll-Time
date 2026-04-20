import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { NLCorrectionWidget } from '../components/NLCorrectionWidget';
import { TimesheetView } from '../components/TimesheetView';
import { ApiError } from '../lib/api';
import { employees, timesheets } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

/**
 * Manager/admin view — pick an employee, inspect their current-period
 * timesheet, approve or unapprove the period. Auto-closed + open entries
 * stand out in the list via the badges the TimesheetView renders.
 */
export function TimesheetsReviewPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();

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

  const sheet = useQuery({
    queryKey: ['timesheet', companyId, effectiveId],
    queryFn: () => timesheets.get(companyId, effectiveId!),
    enabled: effectiveId != null,
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
            <div className="flex items-center justify-end gap-2">
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
            <TimesheetView data={sheet.data} />
            <NLCorrectionWidget
              companyId={companyId}
              employeeId={sheet.data.employee.id}
              periodStart={sheet.data.period.start}
              periodEnd={sheet.data.period.end}
              onApplied={() =>
                qc.invalidateQueries({ queryKey: ['timesheet', companyId, effectiveId] })
              }
            />
            {(approve.isError || unapprove.isError) && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Approval action failed.
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
