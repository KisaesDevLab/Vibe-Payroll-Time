// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { TimeEntry, TimeFormat, WeeklyGridResponse } from '@vibept/shared';
import { TIME_OFF_CATEGORY_LABELS, formatHours } from '@vibept/shared';

/**
 * One printable page for one employee's week: the job × day hours grid
 * (same numbers as the on-screen weekly grid), then every entry behind
 * those numbers grouped by day, then signature lines.
 *
 * Pure render from a WeeklyGridResponse — no fetching, no actions — so
 * the single-employee and "print all" paths draw identical sheets.
 * Punch times render in the company's timezone, not the browser's, so a
 * sheet printed from another timezone still shows the real clock times.
 */

export const SOURCE_LABELS: Record<TimeEntry['source'], string> = {
  kiosk: 'Kiosk',
  web: 'Web',
  mobile_pwa: 'Phone',
  web_manual: 'Manual',
};

/** YYYY-MM-DD of an instant in `tz` (en-CA formats as ISO dates). */
export function isoDateInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export function formatClock(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
  });
}

function dayLabel(date: string, opts: Intl.DateTimeFormatOptions): string {
  // Dates are calendar days; render at UTC noon so no timezone can shift them.
  return new Date(date + 'T12:00:00Z').toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
}

/** Entries grouped by the company-local day they started on. */
export function entriesByDay(grid: WeeklyGridResponse): Map<string, TimeEntry[]> {
  const byDay = new Map<string, TimeEntry[]>(grid.days.map((d) => [d.date, []]));
  for (const e of grid.entries) {
    const day = isoDateInTz(e.startedAt, grid.company.timezone);
    // An entry that started the night before the week still shows,
    // under the first day it contributes hours to.
    const bucket = byDay.get(day) ?? byDay.get(grid.days[0]?.date ?? '');
    bucket?.push(e);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return byDay;
}

export function WeeklyTimesheetPrint({
  grid,
  format,
}: {
  grid: WeeklyGridResponse;
  format: TimeFormat;
}): JSX.Element {
  const tz = grid.company.timezone;
  const jobsById = new Map(grid.jobs.map((j) => [j.id, j]));
  const totalsByJob = new Map(grid.jobTotals.map((t) => [t.jobId, t.seconds]));
  const cellSeconds = new Map(grid.cells.map((c) => [`${c.jobId ?? '_'}|${c.date}`, c.seconds]));

  // Only rows with hours print; a paper timesheet doesn't need 30 empty jobs.
  const withHours = (id: number | null) => (totalsByJob.get(id) ?? 0) > 0;
  const workRows: Array<{ id: number | null; code: string; name: string }> = [
    ...grid.jobs.filter((j) => !j.isTimeOff && withHours(j.id)),
    ...(withHours(null) ? [{ id: null, code: '—', name: 'No job' }] : []),
  ];
  const timeOffRows = grid.jobs.filter((j) => j.isTimeOff && withHours(j.id));
  const hasTimeOff = grid.weekTimeOffSeconds > 0;
  const byDay = entriesByDay(grid);
  const lastDay = grid.days[grid.days.length - 1]?.date ?? grid.week.end;

  const hrs = (s: number) => (s > 0 ? formatHours(s, format) : '');
  const jobLabel = (e: TimeEntry) => {
    if (e.entryType === 'break') return 'Break';
    if (e.jobId == null) return '—';
    const j = jobsById.get(e.jobId);
    return j ? `${j.code} · ${j.name}` : `Job ${e.jobId}`;
  };

  const row = (r: { id: number | null; code: string; name: string }) => (
    <tr key={String(r.id)}>
      <th className="text-left font-normal">
        <span className="font-medium">{r.code}</span> {r.name}
      </th>
      {grid.days.map((d) => (
        <td key={d.date} className="text-right font-mono">
          {hrs(cellSeconds.get(`${r.id ?? '_'}|${d.date}`) ?? 0)}
        </td>
      ))}
      <td className="text-right font-mono font-semibold">{hrs(totalsByJob.get(r.id) ?? 0)}</td>
    </tr>
  );

  return (
    <article className="print-sheet text-slate-900">
      <header className="mb-3 flex items-end justify-between border-b-2 border-slate-900 pb-2">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-600">{grid.company.name}</p>
          <h2 className="text-xl font-semibold">
            {grid.employee.firstName} {grid.employee.lastName}
          </h2>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">Weekly timesheet</p>
          <p>
            {dayLabel(grid.week.start, { month: 'short', day: 'numeric', year: 'numeric' })} –{' '}
            {dayLabel(lastDay, { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
          <p className="text-xs text-slate-600">
            {grid.allApproved ? 'Approved' : 'Not yet approved'} · Times in {tz}
          </p>
        </div>
      </header>

      <table className="print-table mb-4 w-full">
        <thead>
          <tr>
            <th className="text-left">Job</th>
            {grid.days.map((d) => (
              <th key={d.date} className="text-right">
                {dayLabel(d.date, { weekday: 'short' })}
                <br />
                {dayLabel(d.date, { month: 'numeric', day: 'numeric' })}
              </th>
            ))}
            <th className="text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {workRows.length === 0 && timeOffRows.length === 0 && (
            <tr>
              <td colSpan={grid.days.length + 2} className="text-center text-slate-500">
                No time recorded this week.
              </td>
            </tr>
          )}
          {workRows.map(row)}
          <tr className="print-total">
            <th className="text-left">{hasTimeOff ? 'Worked' : 'Daily total'}</th>
            {grid.days.map((d) => (
              <td key={d.date} className="text-right font-mono">
                {hrs(d.totalSeconds)}
              </td>
            ))}
            <td className="text-right font-mono">{formatHours(grid.weekTotalSeconds, format)}</td>
          </tr>
          {hasTimeOff && (
            <>
              {timeOffRows.map((j) =>
                row({
                  id: j.id,
                  code: j.code,
                  name: j.timeOffCategory
                    ? `${j.name} (${TIME_OFF_CATEGORY_LABELS[j.timeOffCategory]}${j.isPaid ? '' : ', unpaid'})`
                    : j.name,
                }),
              )}
              <tr className="print-total">
                <th className="text-left">Time off</th>
                {grid.days.map((d) => (
                  <td key={d.date} className="text-right font-mono">
                    {hrs(d.timeOffSeconds)}
                  </td>
                ))}
                <td className="text-right font-mono">
                  {formatHours(grid.weekTimeOffSeconds, format)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <h3 className="mb-1 text-sm font-semibold">Time entries</h3>
      <table className="print-table mb-6 w-full">
        <thead>
          <tr>
            <th className="text-left">Day</th>
            <th className="text-left">In</th>
            <th className="text-left">Out</th>
            <th className="text-right">Hours</th>
            <th className="text-left">Job</th>
            <th className="text-left">Source</th>
            <th className="text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {grid.entries.length === 0 && (
            <tr>
              <td colSpan={7} className="text-center text-slate-500">
                No entries.
              </td>
            </tr>
          )}
          {grid.days.flatMap((d) =>
            (byDay.get(d.date) ?? []).map((e, i) => {
              // Manual entries carry a duration, not real clock times.
              const manual = e.source === 'web_manual';
              const notes = [
                e.entryReason,
                !e.endedAt && 'Still open',
                e.isAutoClosed && 'Auto-closed',
                e.sourceOffline && 'Offline punch',
                e.approvedAt && 'Approved',
              ].filter(Boolean);
              return (
                <tr key={e.id} className={i === 0 ? 'print-day-start' : ''}>
                  <td>
                    {i === 0
                      ? dayLabel(d.date, { weekday: 'short', month: 'numeric', day: 'numeric' })
                      : ''}
                  </td>
                  <td className="font-mono">{manual ? '—' : formatClock(e.startedAt, tz)}</td>
                  <td className="font-mono">
                    {manual ? '—' : e.endedAt ? formatClock(e.endedAt, tz) : 'open'}
                  </td>
                  <td className="text-right font-mono">
                    {e.durationSeconds != null ? formatHours(e.durationSeconds, format) : ''}
                  </td>
                  <td>{jobLabel(e)}</td>
                  <td>{SOURCE_LABELS[e.source]}</td>
                  <td>{notes.join(' · ')}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>

      <div className="grid grid-cols-2 gap-10 pt-6 text-sm">
        <div>
          <div className="h-8 border-b border-slate-900" />
          <p className="mt-1 flex justify-between">
            <span>Employee signature</span>
            <span>Date</span>
          </p>
        </div>
        <div>
          <div className="h-8 border-b border-slate-900" />
          <p className="mt-1 flex justify-between">
            <span>Supervisor signature</span>
            <span>Date</span>
          </p>
        </div>
      </div>
    </article>
  );
}
