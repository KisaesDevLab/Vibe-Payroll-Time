// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MissingTimeEmployee,
  MissingTimePeriod,
  MissingTimeSkipReason,
  SendMissingTimeRemindersResponse,
} from '@vibept/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../lib/api';
import { missingTime } from '../lib/resources';
import { Button } from './Button';
import { Modal } from './Modal';

const SKIP_LABELS: Record<MissingTimeSkipReason, string> = {
  approved: 'Period approved',
  kiosk_only: 'No sign-in (kiosk only)',
  opted_out: 'Reminders off',
  no_contact: 'No email or verified phone',
};

function shortDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function longDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Who has missing days in the current or previous pay period, and a
 * "remind them now" for the ones who can be reminded. The server
 * re-checks everything on send, so a day filled in meanwhile is not
 * reminded about.
 */
export function MissingTimeRemindersModal({
  companyId,
  onClose,
}: {
  companyId: number;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<MissingTimePeriod>('previous');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<SendMissingTimeRemindersResponse | null>(null);

  const reportQ = useQuery({
    queryKey: ['missing-time', companyId, period],
    queryFn: () => missingTime.report(companyId, period),
  });

  const eligible = useMemo(
    () => (reportQ.data?.employees ?? []).filter((e) => !e.skipReason),
    [reportQ.data],
  );
  // Everyone who can be reminded starts selected — once per period, so
  // the refetch after a send doesn't quietly re-select them.
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (!reportQ.data || initialized.current === period) return;
    initialized.current = period;
    setSelected(new Set(eligible.map((e) => e.employeeId)));
  }, [reportQ.data, eligible, period]);

  const send = useMutation({
    mutationFn: () => missingTime.remind(companyId, { period, employeeIds: [...selected] }),
    onSuccess: (res) => {
      setResult(res);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['missing-time', companyId] });
    },
  });

  const report = reportQ.data;
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal
      open
      onClose={onClose}
      title="Missing time"
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {selected.size} of {eligible.length} selected
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              loading={send.isPending}
              disabled={selected.size === 0}
              onClick={() => {
                setResult(null);
                send.mutate();
              }}
            >
              Send {selected.size} reminder{selected.size === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="tablist"
            aria-label="Pay period"
            className="inline-flex rounded-md border border-slate-300 bg-white text-sm shadow-sm"
          >
            {(['previous', 'current'] as const).map((p, i) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={period === p}
                onClick={() => {
                  setResult(null);
                  setPeriod(p);
                }}
                className={
                  'px-3 py-1.5 font-medium transition ' +
                  (i === 0 ? 'rounded-l-md ' : 'rounded-r-md border-l border-slate-300 ') +
                  (period === p ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50')
                }
              >
                {p === 'previous' ? 'Last pay period' : 'This pay period'}
              </button>
            ))}
          </div>
          {report && (
            <span className="text-xs text-slate-500">
              {longDay(report.period.start)} – {longDay(report.period.end)}
              {report.checkedThrough && report.checkedThrough !== report.period.end
                ? ` · checked through ${longDay(report.checkedThrough)}`
                : ''}
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500">
          A day is missing when it is one of the employee&apos;s work days, on or after their hire
          date, with no work or time-off entry. Each reminder lists the days and links to the
          employee&apos;s timesheet.
        </p>

        {result && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Sent {result.sent} reminder{result.sent === 1 ? '' : 's'}.
            {result.skipped.length > 0 &&
              ` ${result.skipped.length} skipped (nothing missing any more, or can't be reminded).`}
          </div>
        )}
        {send.error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {send.error instanceof ApiError ? send.error.message : 'Sending failed.'}
          </div>
        )}

        {reportQ.isLoading && <p className="text-sm text-slate-500">Checking timesheets…</p>}
        {reportQ.isError && (
          <p className="text-sm text-red-700">
            {reportQ.error instanceof ApiError ? reportQ.error.message : 'Could not load.'}
          </p>
        )}
        {report && !report.checkedThrough && (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            This pay period started today, so there are no past days to check yet.
          </p>
        )}
        {report && report.checkedThrough && report.employees.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            Nobody is missing time in this pay period.
          </p>
        )}

        {report && report.employees.length > 0 && (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-slate-200">
            {eligible.length > 1 && (
              <label className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selected.size === eligible.length}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? new Set(eligible.map((x) => x.employeeId)) : new Set(),
                    )
                  }
                />
                Select everyone who can be reminded
              </label>
            )}
            <ul className="divide-y divide-slate-100">
              {report.employees.map((e) => (
                <MissingRow
                  key={e.employeeId}
                  row={e}
                  checked={selected.has(e.employeeId)}
                  onToggle={() => toggle(e.employeeId)}
                />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function MissingRow({
  row,
  checked,
  onToggle,
}: {
  row: MissingTimeEmployee;
  checked: boolean;
  onToggle: () => void;
}): JSX.Element {
  const disabled = !!row.skipReason;
  return (
    <li className={'px-3 py-2.5 text-sm ' + (disabled ? 'bg-slate-50/60' : '')}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-slate-900">
              {row.lastName}, {row.firstName}
            </span>
            <span className="text-xs text-slate-500">
              {row.missingDates.length} day{row.missingDates.length === 1 ? '' : 's'}
              {row.remindersSent > 0 &&
                ` · reminded ${row.remindersSent}×${
                  row.lastRemindedAt
                    ? `, last ${new Date(row.lastRemindedAt).toLocaleDateString()}`
                    : ''
                }`}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            {row.missingDates.map((d) => (
              <span
                key={d}
                className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] text-amber-900"
              >
                {shortDay(d)}
              </span>
            ))}
          </span>
          {row.skipReason && (
            <span className="mt-1 block text-xs text-slate-500">
              Can&apos;t remind: {SKIP_LABELS[row.skipReason]}
            </span>
          )}
        </span>
      </label>
    </li>
  );
}
