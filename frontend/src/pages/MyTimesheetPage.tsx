// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeEntry } from '@vibept/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { NLCorrectionWidget } from '../components/NLCorrectionWidget';
import { TimesheetView } from '../components/TimesheetView';
import { TopBar } from '../components/TopBar';
import { usePunchCompany } from '../hooks/usePunchCompany';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { jobs as jobsApi, timesheets } from '../lib/resources';

/**
 * Employee's own timesheet for the current pay period. Shows entries
 * grouped by day with daily and period totals, lets them raise a
 * "request fix" correction on unapproved entries.
 */
export function MyTimesheetPage() {
  const session = useSession();
  // Same reasoning as MyPunchPage — admin-only memberships can't view
  // a timesheet (no employees row), so hide them from the picker.
  // Shares the remembered company with MyPunchPage.
  const { memberships, companyId, setCompanyId, company } = usePunchCompany();

  const [correction, setCorrection] = useState<TimeEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);
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
            <p className="text-xs uppercase tracking-widest text-slate-500">
              {company?.companyName ?? 'No company'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              My timesheet
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Current pay period. Request a fix on any entry that needs correcting.
            </p>
            {sheet.data && companyId != null && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="inline-flex overflow-hidden rounded-full border border-slate-300 text-xs font-medium">
                  <span className="bg-slate-900 px-3 py-1.5 text-white">List view</span>
                  <Link
                    to={`/companies/${companyId}/timesheets/${sheet.data.employee.id}/week`}
                    className="px-3 py-1.5 text-slate-600 hover:bg-slate-100"
                  >
                    Grid view →
                  </Link>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setAddNotice(null);
                    setAddOpen(true);
                  }}
                >
                  + Add time
                </Button>
              </div>
            )}
            {addNotice && (
              <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {addNotice}
              </p>
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

        {memberships.length === 0 && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You don't have an active employee record at any company, so there's no timesheet to
            show. Admin-only memberships don't track hours.
          </section>
        )}

        {memberships.length > 0 && sheet.isPending && (
          <p className="text-sm text-slate-500">Loading timesheet…</p>
        )}
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

      {addOpen && companyId != null && (
        <AddTimeModal
          companyId={companyId}
          onClose={() => setAddOpen(false)}
          onDone={(message) => {
            setAddOpen(false);
            setAddNotice(message);
            qc.invalidateQueries({ queryKey: ['my-timesheet', companyId] });
          }}
        />
      )}

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

/** `YYYY-MM-DD` for a local Date. */
function localIsoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Add a shift the employee forgot to punch: a date, clock-in and
 * clock-out time, an optional job, and a reason. A clock-out earlier than
 * the clock-in means the shift ran past midnight. The server saves it
 * straight away or sends it to a supervisor, per the company's policy.
 */
function AddTimeModal({
  companyId,
  onClose,
  onDone,
}: {
  companyId: number;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [day, setDay] = useState(() => localIsoDay(new Date()));
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const jobsQ = useQuery({
    queryKey: ['jobs', companyId, false],
    queryFn: () => jobsApi.list(companyId),
  });
  const workJobs = (jobsQ.data ?? []).filter((j) => !j.isTimeOff);

  const span = (() => {
    if (!day || !clockIn || !clockOut) return null;
    const start = new Date(`${day}T${clockIn}`);
    const end = new Date(`${day}T${clockOut}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const overnight = end <= start;
    if (overnight) end.setDate(end.getDate() + 1);
    return { start, end, overnight, hours: (end.getTime() - start.getTime()) / 3_600_000 };
  })();

  const submit = useMutation({
    mutationFn: () =>
      timesheets.addOwnEntry(companyId, {
        startedAt: span!.start.toISOString(),
        endedAt: span!.end.toISOString(),
        jobId,
        reason: reason.trim(),
      }),
    onSuccess: (r) =>
      onDone(
        r.status === 'added'
          ? 'Time added to your timesheet.'
          : 'Sent to your supervisor for approval. It shows on your timesheet once approved.',
      ),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add time"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!span || !reason.trim()}
            loading={submit.isPending}
            onClick={() => submit.mutate()}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          Forgot to clock in or out? Enter the times you actually worked.
        </p>
        <FormField
          label="Date"
          type="date"
          value={day}
          max={localIsoDay(new Date())}
          onChange={(e) => setDay(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Clock in"
            type="time"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
          <FormField
            label="Clock out"
            type="time"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
        </div>
        {span && (
          <p className="text-xs text-slate-600">
            {span.hours.toFixed(2)} hrs
            {span.overnight ? ' · ends the next day' : ''}
          </p>
        )}
        {workJobs.length > 0 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Job (optional)</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
              value={jobId ?? ''}
              onChange={(e) => setJobId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— none —</option>
              {workJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.code} — {j.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Reason</span>
          <textarea
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            rows={2}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Phone was dead, forgot to clock in"
          />
        </label>
        {submit.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {submit.error instanceof ApiError ? submit.error.message : 'Could not save.'}
          </div>
        )}
      </div>
    </Modal>
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
