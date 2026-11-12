// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import {
  TIME_OFF_CATEGORY_LABELS,
  formatHours,
  type TimeEntry,
  type TimesheetResponse,
} from '@vibept/shared';
import { useMemo, useState, type ReactNode } from 'react';
import { formatCivilDay, formatClock, zoneNotice } from '../lib/company-time';
import { formatCoords, mapLinkFor } from '../lib/punch-location';
import { EntryAuditDrawer } from './EntryAuditDrawer';

/** Clock time of an instant in the company's timezone. */
function formatTime(iso: string | null, tz?: string): string {
  if (!iso) return '—';
  return formatClock(iso, tz);
}

/** A civil day (`YYYY-MM-DD`, already in company tz) as "Mon, Nov 9". */
function formatDate(isoDay: string): string {
  return formatCivilDay(isoDay);
}

/**
 * Where the punch that opened and the punch that closed this entry
 * happened, when the company records locations. Captured fixes link to
 * a map; a refused or failed fix shows as a muted status so a reviewer
 * can tell "not asked" from "asked and got nothing".
 */
function LocationBadges({ entry }: { entry: TimeEntry }) {
  const sides = [
    { label: 'in', loc: entry.startedLocation, status: entry.startedLocationStatus },
    { label: 'out', loc: entry.endedLocation, status: entry.endedLocationStatus },
  ];
  return (
    <>
      {sides.map(({ label, loc, status }) => {
        if (loc) {
          return (
            <a
              key={label}
              href={mapLinkFor(loc)}
              target="_blank"
              rel="noreferrer"
              title={formatCoords(loc)}
              className="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800 hover:underline"
            >
              📍 {label}
            </a>
          );
        }
        if (status) {
          return (
            <span
              key={label}
              title={`No location recorded at clock-${label}: ${status}`}
              className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              no location ({label})
            </span>
          );
        }
        return null;
      })}
    </>
  );
}

export function TimesheetView({
  data,
  onRequestCorrection,
  onEditEntry,
  onDeleteEntry,
  pendingRequestEntryIds,
  timeOffFixHint,
  allowApprovedChanges = false,
}: {
  data: TimesheetResponse;
  /** Company admins may edit and delete approved entries too (the change
   *  is audited); everyone else stops at approval. */
  allowApprovedChanges?: boolean;
  /** Employee "Request fix". Not offered on time-off entries (changed on
   *  the grid) or entries that already have a pending request. */
  onRequestCorrection?: (entry: TimeEntry) => void;
  /** Entries with a correction request awaiting review; badged. */
  pendingRequestEntryIds?: ReadonlySet<number>;
  /** Shown in place of "Request fix" on a time-off entry, e.g. a link to
   *  the grid where time off is changed. */
  timeOffFixHint?: ReactNode;
  /** Supervisor/admin inline edit. When present, renders "Edit" in each
   *  row's actions so long as the entry isn't approved (or
   *  `allowApprovedChanges` is set). */
  onEditEntry?: (entry: TimeEntry) => void;
  /** Supervisor/admin soft-delete. Same visibility rules as edit. */
  onDeleteEntry?: (entry: TimeEntry) => void;
}) {
  const [auditEntryId, setAuditEntryId] = useState<number | null>(null);
  // Every clock time and hours figure follows the company's timezone and
  // the viewer's hours format, both resolved by the server.
  const tz = data.companyTimezone;
  const hrs = (seconds: number) => formatHours(seconds, data.timeFormat);
  const zoneLabel = tz ? zoneNotice(tz) : null;
  // Time-off codes used this period → their category, to label entries.
  const timeOffCategoryByJob = useMemo(
    () => new Map(data.timeOffBreakdown.map((t) => [t.jobId, t.category])),
    [data.timeOffBreakdown],
  );
  const timeOffParts = Object.entries(data.timeOff.byCategory)
    .filter(([, secs]) => (secs ?? 0) > 0)
    .map(
      ([cat, secs]) =>
        `${TIME_OFF_CATEGORY_LABELS[cat as keyof typeof TIME_OFF_CATEGORY_LABELS]} ${hrs(secs ?? 0)}`,
    );

  // Bucket entries by their authoritative day-id assignment from the
  // backend. The summary's day.entryIds list is computed in the
  // COMPANY'S timezone, so it matches data.days[].date; doing the
  // bucketing client-side with `toISOString().slice(0,10)` assigns
  // entries to the UTC day, which silently mis-buckets everything near
  // midnight UTC (entries then disappear from the table while still
  // contributing to the totals).
  const entriesByDay = useMemo(() => {
    const byId = new Map<number, TimeEntry>();
    for (const e of data.entries) byId.set(e.id, e);
    const map = new Map<string, TimeEntry[]>();
    for (const day of data.days) {
      const arr: TimeEntry[] = [];
      for (const id of day.entryIds) {
        const e = byId.get(id);
        if (e) arr.push(e);
      }
      map.set(day.date, arr);
    }
    return map;
  }, [data.entries, data.days]);

  return (
    <div className="flex flex-col gap-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {data.employee.firstName} {data.employee.lastName}
            </h2>
            <p className="text-xs text-slate-500">
              {formatDate(data.period.firstDay)} → {formatDate(data.period.lastDay)} ·{' '}
              {data.period.type.replace('_', '-')}
            </p>
            {zoneLabel && <p className="text-xs text-slate-500">{zoneLabel}</p>}
          </div>
          {data.isApproved ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              Approved
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Pending approval
            </span>
          )}
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
          <Total label="Regular" value={hrs(data.totals.regularSeconds)} unit="hrs" />
          <Total
            label="Overtime"
            value={hrs(data.totals.overtimeSeconds)}
            unit="hrs"
            highlight={data.totals.overtimeSeconds > 0}
          />
          <Total label="Break" value={hrs(data.totals.breakSeconds)} unit="hrs" />
          <Total label="Worked" value={hrs(data.totals.workSeconds)} unit="hrs" />
        </dl>
        {data.timeOff.totalSeconds > 0 && (
          <p className="mt-3 text-sm text-slate-700">
            <span className="font-medium">Time off this period:</span>{' '}
            {hrs(data.timeOff.totalSeconds)} hrs ({timeOffParts.join(' · ')}). Paid but not worked;
            not counted toward overtime.
          </p>
        )}
      </header>

      {data.days.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No entries in this period yet.
        </div>
      )}

      {data.days.map((day) => {
        const dayEntries = entriesByDay.get(day.date) ?? [];
        return (
          <section
            key={day.date}
            className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
          >
            <header className="flex items-center justify-between bg-slate-50 px-5 py-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {formatCivilDay(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}
                </p>
              </div>
              <p className="text-xs text-slate-500">
                Work {hrs(day.workSeconds)} hrs · Break {hrs(day.breakSeconds)} hrs
                {day.timeOffSeconds > 0 && <> · Time off {hrs(day.timeOffSeconds)} hrs</>}
              </p>
            </header>
            {/* Scrolls sideways on a phone rather than clipping the actions. */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-white text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Type</th>
                    <th className="px-5 py-2 text-left font-medium">Start</th>
                    <th className="px-5 py-2 text-left font-medium">End</th>
                    <th className="px-5 py-2 text-left font-medium">Hours</th>
                    <th className="px-5 py-2 text-left font-medium">Source</th>
                    <th className="px-5 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dayEntries.map((e) => {
                    // Time off is hours on a day, not a span of clock time: its
                    // stored start/end are a placeholder, so don't show them.
                    const isTimeOff = e.jobId != null && timeOffCategoryByJob.has(e.jobId);
                    const pendingFix = pendingRequestEntryIds?.has(e.id) ?? false;
                    return (
                      <tr key={e.id}>
                        <td className="px-5 py-2">
                          <span
                            className={
                              'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ' +
                              (isTimeOff
                                ? 'bg-emerald-100 text-emerald-800'
                                : e.entryType === 'work'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-amber-100 text-amber-800')
                            }
                          >
                            {isTimeOff
                              ? `time off · ${TIME_OFF_CATEGORY_LABELS[timeOffCategoryByJob.get(e.jobId!)!]}`
                              : e.entryType}
                          </span>
                          {pendingFix && (
                            <span className="ml-1 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              fix requested
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2 font-mono text-xs text-slate-700">
                          {isTimeOff ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            formatTime(e.startedAt, tz)
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2 font-mono text-xs text-slate-700">
                          {isTimeOff ? (
                            <span className="text-slate-400">—</span>
                          ) : e.endedAt ? (
                            formatTime(e.endedAt, tz)
                          ) : (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                              OPEN
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-2 font-mono text-xs text-slate-700">
                          {e.durationSeconds != null ? hrs(e.durationSeconds) : '—'}
                        </td>
                        <td className="px-5 py-2 text-xs text-slate-500">
                          {e.source}
                          {e.sourceOffline && (
                            <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                              offline
                            </span>
                          )}
                          {e.isAutoClosed && (
                            <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-800">
                              auto-closed
                            </span>
                          )}
                          <LocationBadges entry={e} />
                        </td>
                        <td className="px-5 py-2 text-right text-xs">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              className="text-slate-600 hover:underline"
                              onClick={() => setAuditEntryId(e.id)}
                            >
                              History
                            </button>
                            {onRequestCorrection &&
                              !e.approvedAt &&
                              e.supersededByEntryId == null &&
                              (isTimeOff ? (
                                timeOffFixHint
                              ) : pendingFix ? null : (
                                <button
                                  type="button"
                                  className="whitespace-nowrap text-slate-700 hover:underline"
                                  onClick={() => onRequestCorrection(e)}
                                >
                                  Request fix
                                </button>
                              ))}
                            {onEditEntry && (!e.approvedAt || allowApprovedChanges) && (
                              <button
                                type="button"
                                className="text-slate-900 hover:underline"
                                onClick={() => onEditEntry(e)}
                              >
                                Edit
                              </button>
                            )}
                            {onDeleteEntry && (!e.approvedAt || allowApprovedChanges) && (
                              <button
                                type="button"
                                className="text-red-700 hover:underline"
                                onClick={() => onDeleteEntry(e)}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      {auditEntryId != null && (
        <EntryAuditDrawer
          companyId={data.employee.companyId}
          entryId={auditEntryId}
          timezone={data.companyTimezone}
          onClose={() => setAuditEntryId(null)}
        />
      )}
    </div>
  );
}

function Total({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd
        className={
          'mt-0.5 text-lg font-semibold ' + (highlight ? 'text-amber-700' : 'text-slate-900')
        }
      >
        {value}
        <span className="ml-1 text-xs font-normal text-slate-500">{unit}</span>
      </dd>
    </div>
  );
}

export { formatTime, formatDate };
