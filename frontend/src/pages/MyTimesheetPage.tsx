// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TIME_OFF_CATEGORY_LABELS,
  formatHours,
  todayInTz,
  type CorrectionRequest,
  type Job,
  type TimeEntry,
  type TimeFormat,
} from '@vibept/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { HoursInput } from '../components/HoursInput';
import { Modal } from '../components/Modal';
import { NLCorrectionWidget } from '../components/NLCorrectionWidget';
import { TimesheetView } from '../components/TimesheetView';
import { TopBar } from '../components/TopBar';
import { usePunchCompany } from '../hooks/usePunchCompany';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { buildShiftSpan, correctionChanges, toZoneInput, zoneNotice } from '../lib/company-time';
import { describeCorrection } from '../lib/correction-summary';
import { jobs as jobsApi, manualEntries, timesheets } from '../lib/resources';
import { MY_CORRECTION_REQUESTS_KEY, invalidateTimeEntryQueries } from '../lib/timesheet-queries';

/** Where the employee's own weekly grid lives (outside the admin layout). */
const MY_GRID_PATH = '/my-timesheet/week';

/**
 * Employee's own timesheet for the current pay period. Shows entries
 * grouped by day with daily and period totals, lets them raise a
 * "request fix" correction on unapproved entries, and lists the
 * requests they've made with their outcome.
 *
 * Every time on this page is in the company's timezone (the server buckets
 * days and periods there), whatever zone the browser is in.
 */
export function MyTimesheetPage() {
  const session = useSession();
  // Same reasoning as MyPunchPage — admin-only memberships can't view
  // a timesheet (no employees row), so hide them from the picker.
  // Shares the remembered company with MyPunchPage.
  const { memberships, companyId, setCompanyId, company } = usePunchCompany();

  const [correction, setCorrection] = useState<TimeEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const qc = useQueryClient();

  const sheet = useQuery({
    queryKey: ['my-timesheet', companyId],
    queryFn: () => timesheets.current(companyId!),
    enabled: companyId != null,
  });
  // The company's active time-off codes (PTO, Sick, …), shared with the
  // Add time popup's job list via the same query key.
  const jobsQ = useQuery({
    queryKey: ['jobs', companyId, false],
    queryFn: () => jobsApi.list(companyId!),
    enabled: companyId != null,
  });
  const requestsQ = useQuery({
    queryKey: [MY_CORRECTION_REQUESTS_KEY, companyId],
    queryFn: () => timesheets.myCorrectionRequests(companyId!),
    enabled: companyId != null,
  });
  const timeOffCodes = (jobsQ.data ?? []).filter((j) => j.isTimeOff && !j.archivedAt);
  const pendingRequestEntryIds = useMemo(
    () =>
      new Set(
        (requestsQ.data ?? [])
          .filter((r) => r.status === 'pending' && r.timeEntryId != null)
          .map((r) => r.timeEntryId!),
      ),
    [requestsQ.data],
  );

  const refresh = () => invalidateTimeEntryQueries(qc);

  if (!session) return null;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
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
                  <Link to={MY_GRID_PATH} className="px-3 py-1.5 text-slate-600 hover:bg-slate-100">
                    Grid view →
                  </Link>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setNotice(null);
                    setAddOpen(true);
                  }}
                >
                  + Add time
                </Button>
                {sheet.data.timeOffSelfEntry && timeOffCodes.length > 0 && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setNotice(null);
                      setTimeOffOpen(true);
                    }}
                  >
                    + Time off
                  </Button>
                )}
              </div>
            )}
            {notice && (
              <p
                role="status"
                className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
              >
                {notice}
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
            <TimesheetView
              data={sheet.data}
              onRequestCorrection={setCorrection}
              pendingRequestEntryIds={pendingRequestEntryIds}
              timeOffFixHint={
                <Link
                  to={MY_GRID_PATH}
                  className="whitespace-nowrap text-slate-500 hover:underline"
                  title="Time off is hours on a day; change it on the grid"
                >
                  Change on grid
                </Link>
              }
            />
            <MyRequests
              requests={requestsQ.data}
              loading={requestsQ.isPending}
              timezone={sheet.data.companyTimezone}
              timeFormat={sheet.data.timeFormat}
            />
            <NLCorrectionWidget
              companyId={sheet.data.employee.companyId}
              employeeId={sheet.data.employee.id}
              periodStart={sheet.data.period.start}
              periodEnd={sheet.data.period.end}
              companyTimezone={sheet.data.companyTimezone}
              entries={sheet.data.entries}
              onApplied={refresh}
            />
          </div>
        )}
      </main>

      {addOpen && companyId != null && sheet.data && (
        <AddTimeModal
          companyId={companyId}
          timezone={sheet.data.companyTimezone}
          timeFormat={sheet.data.timeFormat}
          onClose={() => setAddOpen(false)}
          onDone={(message) => {
            setAddOpen(false);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {timeOffOpen && companyId != null && sheet.data && (
        <TimeOffModal
          companyId={companyId}
          employeeId={sheet.data.employee.id}
          codes={timeOffCodes}
          timezone={sheet.data.companyTimezone}
          timeFormat={sheet.data.timeFormat}
          onClose={() => setTimeOffOpen(false)}
          onDone={(message) => {
            setTimeOffOpen(false);
            setNotice(message);
            refresh();
          }}
        />
      )}

      {correction && companyId != null && sheet.data && (
        <CorrectionRequestModal
          companyId={companyId}
          entry={correction}
          timezone={sheet.data.companyTimezone}
          onClose={() => setCorrection(null)}
          onSubmitted={() => {
            setCorrection(null);
            setNotice(
              'Fix request sent to your supervisor. The entry stays as it is until they approve it; track it under My requests.',
            );
            refresh();
          }}
        />
      )}
    </>
  );
}

const STATUS_BADGE: Record<CorrectionRequest['status'], string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-slate-200 text-slate-700',
};

/** How many requests show before "Show all". */
const REQUESTS_SHOWN = 5;

/**
 * The employee's own correction requests (fixes and added shifts that
 * needed approval), newest first, with the supervisor's decision and note.
 */
function MyRequests({
  requests,
  loading,
  timezone,
  timeFormat,
}: {
  requests: CorrectionRequest[] | undefined;
  loading: boolean;
  timezone: string;
  timeFormat: TimeFormat;
}) {
  const [showAll, setShowAll] = useState(false);
  if (loading || !requests || requests.length === 0) return null;
  const shown = showAll ? requests : requests.slice(0, REQUESTS_SHOWN);
  const pending = requests.filter((r) => r.status === 'pending').length;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">My requests</h2>
        <p className="text-xs text-slate-500">
          {pending > 0 ? `${pending} awaiting review` : 'None awaiting review'}
        </p>
      </header>
      <ul className="mt-3 divide-y divide-slate-100">
        {shown.map((r) => (
          <li key={r.id} className="py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  'rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ' +
                  STATUS_BADGE[r.status]
                }
              >
                {r.status}
              </span>
              <span className="text-slate-800">{describeCorrection(r, timezone, timeFormat)}</span>
            </div>
            <p className="mt-1 text-slate-600">“{r.reason}”</p>
            <p className="mt-1 text-xs text-slate-500">
              Sent{' '}
              {new Date(r.createdAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: timezone,
              })}
              {r.reviewedAt &&
                ` · ${r.status} ${new Date(r.reviewedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: timezone,
                })}`}
            </p>
            {r.reviewNote && (
              <p className="mt-1 text-xs text-slate-700">
                <span className="font-medium">Supervisor note:</span> {r.reviewNote}
              </p>
            )}
          </li>
        ))}
      </ul>
      {requests.length > REQUESTS_SHOWN && (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-slate-700 hover:underline"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show fewer' : `Show all ${requests.length}`}
        </button>
      )}
    </section>
  );
}

/** "Times are in America/Chicago (CST)" under a form, when it isn't the
 *  browser's zone. */
function ZoneNote({ timezone }: { timezone: string }) {
  const label = zoneNotice(timezone);
  return label ? <p className="text-xs font-medium text-slate-600">{label}</p> : null;
}

/**
 * Record PTO, sick, holiday or other time off: a date, the type (the
 * company's active time-off codes), hours, and an optional note. Saved
 * as a time-off entry on that day, like the Time off row of the weekly
 * grid; it never counts toward overtime and goes through normal
 * pay-period approval.
 */
function TimeOffModal({
  companyId,
  employeeId,
  codes,
  timezone,
  timeFormat,
  onClose,
  onDone,
}: {
  companyId: number;
  employeeId: number;
  codes: Job[];
  timezone: string;
  timeFormat: TimeFormat;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [day, setDay] = useState(() => todayInTz(timezone));
  const [jobId, setJobId] = useState<number>(codes[0]!.id);
  const [seconds, setSeconds] = useState<number | null>(8 * 3600);
  const [parseError, setParseError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const code = codes.find((c) => c.id === jobId);

  const submit = useMutation({
    mutationFn: () =>
      manualEntries.create({
        companyId,
        employeeId,
        day,
        jobId,
        durationSeconds: seconds!,
        ...(note.trim() ? { reason: note.trim() } : {}),
      }),
    onSuccess: () =>
      onDone(
        `${code ? (code.timeOffCategory ? TIME_OFF_CATEGORY_LABELS[code.timeOffCategory] : code.name) : 'Time off'} added to your timesheet.`,
      ),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Add time off"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!day || !seconds || seconds <= 0 || !!parseError}
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
          Paid time off, sick time and the like. It shows on your timesheet separately from hours
          worked and never counts toward overtime.
        </p>
        <FormField label="Date" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Type</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            value={jobId}
            onChange={(e) => setJobId(Number(e.target.value))}
          >
            {codes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.isPaid ? '' : ' (unpaid)'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Hours</span>
          <HoursInput
            seconds={seconds}
            format={timeFormat}
            onChange={(s, err) => {
              setSeconds(s);
              setParseError(err);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Note (optional)</span>
          <textarea
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
            rows={2}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
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

/**
 * Add a shift the employee forgot to punch: a date, clock-in and
 * clock-out time, an optional job, and a reason. A clock-out earlier than
 * the clock-in means the shift ran past midnight. The server saves it
 * straight away or sends it to a supervisor, per the company's policy.
 * The date and times are the company's wall clock.
 */
function AddTimeModal({
  companyId,
  timezone,
  timeFormat,
  onClose,
  onDone,
}: {
  companyId: number;
  timezone: string;
  timeFormat: TimeFormat;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = todayInTz(timezone);
  const [day, setDay] = useState(today);
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [jobId, setJobId] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const jobsQ = useQuery({
    queryKey: ['jobs', companyId, false],
    queryFn: () => jobsApi.list(companyId),
  });
  const workJobs = (jobsQ.data ?? []).filter((j) => !j.isTimeOff);

  const span = buildShiftSpan(day, clockIn, clockOut, timezone);

  const submit = useMutation({
    mutationFn: () =>
      timesheets.addOwnEntry(companyId, {
        startedAt: span!.startedAt,
        endedAt: span!.endedAt,
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
        <ZoneNote timezone={timezone} />
        <FormField
          label="Date"
          type="date"
          value={day}
          max={today}
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
            {formatHours(span.seconds, timeFormat)} hrs
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

/**
 * Ask a supervisor to change an entry's start or end. The inputs show the
 * company's wall clock, the same times the timesheet rows show; only the
 * fields the employee changed are proposed.
 */
function CorrectionRequestModal({
  companyId,
  entry,
  timezone,
  onClose,
  onSubmitted,
}: {
  companyId: number;
  entry: TimeEntry;
  timezone: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [startedAt, setStartedAt] = useState(() => toZoneInput(entry.startedAt, timezone));
  const [endedAt, setEndedAt] = useState(() => toZoneInput(entry.endedAt, timezone));
  const [reason, setReason] = useState('');

  const changes = correctionChanges(entry, { startedAt, endedAt }, timezone);
  const changed = Object.keys(changes).length > 0;

  const submit = useMutation({
    mutationFn: () =>
      timesheets.createCorrection(companyId, {
        timeEntryId: entry.id,
        requestType: 'edit',
        proposedChanges: changes,
        reason: reason.trim(),
      }),
    onSuccess: onSubmitted,
  });

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
        <ZoneNote timezone={timezone} />
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
            maxLength={500}
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
