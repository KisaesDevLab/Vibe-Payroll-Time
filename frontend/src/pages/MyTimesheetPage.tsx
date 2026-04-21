import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeEntry } from '@vibept/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { NLCorrectionWidget } from '../components/NLCorrectionWidget';
import { TimesheetView } from '../components/TimesheetView';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { timesheets } from '../lib/resources';

/**
 * Employee's own timesheet for the current pay period. Shows entries
 * grouped by day with daily and period totals, lets them raise a
 * "request fix" correction on unapproved entries.
 */
export function MyTimesheetPage() {
  const session = useSession();
  const memberships = useMemo(() => session?.user.memberships ?? [], [session]);
  const [companyId, setCompanyId] = useState<number | null>(memberships[0]?.companyId ?? null);
  useEffect(() => {
    if (!companyId && memberships[0]) setCompanyId(memberships[0].companyId);
  }, [companyId, memberships]);

  const [correction, setCorrection] = useState<TimeEntry | null>(null);
  const qc = useQueryClient();

  const sheet = useQuery({
    queryKey: ['my-timesheet', companyId],
    queryFn: () => timesheets.current(companyId!),
    enabled: companyId != null,
  });

  if (!session) return null;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">My timesheet</h1>
            <p className="mt-1 text-sm text-slate-600">
              Current pay period. Request a fix on any entry that needs correcting.
            </p>
            {sheet.data && companyId != null && (
              <div className="mt-3 inline-flex overflow-hidden rounded-full border border-slate-300 text-xs font-medium">
                <span className="bg-slate-900 px-3 py-1.5 text-white">List view</span>
                <Link
                  to={`/companies/${companyId}/timesheets/${sheet.data.employee.id}/week`}
                  className="px-3 py-1.5 text-slate-600 hover:bg-slate-100"
                >
                  Grid view →
                </Link>
              </div>
            )}
          </div>
          {memberships.length > 1 && (
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
              value={companyId ?? ''}
              onChange={(e) => setCompanyId(Number(e.target.value))}
            >
              {memberships.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.companyName}
                </option>
              ))}
            </select>
          )}
        </header>

        {sheet.isPending && <p className="text-sm text-slate-500">Loading timesheet…</p>}
        {sheet.isError && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {sheet.error instanceof ApiError ? sheet.error.message : 'Could not load timesheet.'}
          </p>
        )}
        {sheet.data && (
          <div className="flex flex-col gap-6">
            <TimesheetView data={sheet.data} onRequestCorrection={setCorrection} />
            <NLCorrectionWidget
              companyId={sheet.data.employee.companyId}
              employeeId={sheet.data.employee.id}
              periodStart={sheet.data.period.start}
              periodEnd={sheet.data.period.end}
              onApplied={() => qc.invalidateQueries({ queryKey: ['my-timesheet', companyId] })}
            />
          </div>
        )}
      </main>

      {correction && companyId != null && (
        <CorrectionRequestModal
          companyId={companyId}
          entry={correction}
          onClose={() => setCorrection(null)}
          onSubmitted={() => {
            setCorrection(null);
            qc.invalidateQueries({ queryKey: ['my-timesheet', companyId] });
          }}
        />
      )}
    </>
  );
}

function CorrectionRequestModal({
  companyId,
  entry,
  onClose,
  onSubmitted,
}: {
  companyId: number;
  entry: TimeEntry;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [startedAt, setStartedAt] = useState(entry.startedAt.slice(0, 16));
  const [endedAt, setEndedAt] = useState(entry.endedAt?.slice(0, 16) ?? '');
  const [reason, setReason] = useState('');

  const submit = useMutation({
    mutationFn: () => {
      const changes: Record<string, unknown> = {};
      if (startedAt && startedAt !== entry.startedAt.slice(0, 16)) {
        changes.startedAt = new Date(startedAt).toISOString();
      }
      if (endedAt && (!entry.endedAt || endedAt !== entry.endedAt.slice(0, 16))) {
        changes.endedAt = new Date(endedAt).toISOString();
      }
      return timesheets.createCorrection(companyId, {
        timeEntryId: entry.id,
        requestType: 'edit',
        proposedChanges: changes,
        reason,
      });
    },
    onSuccess: onSubmitted,
  });

  const changed =
    startedAt !== entry.startedAt.slice(0, 16) ||
    (endedAt && (!entry.endedAt || endedAt !== entry.endedAt.slice(0, 16)));

  return (
    <Modal
      open
      onClose={onClose}
      title="Request correction"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || !changed}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Submit
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          A manager will review this request. The original entry isn't changed until approved.
        </p>
        <FormField
          label="Start"
          type="datetime-local"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
        />
        <FormField
          label="End"
          type="datetime-local"
          value={endedAt}
          onChange={(e) => setEndedAt(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Reason</span>
          <textarea
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Forgot to clock out after lunch"
          />
        </label>
        {submit.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {submit.error instanceof ApiError ? submit.error.message : 'Submit failed.'}
          </div>
        )}
      </div>
    </Modal>
  );
}
