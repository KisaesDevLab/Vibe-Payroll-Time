import type { TimeEntry, TimesheetResponse } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { EntryAuditDrawer } from './EntryAuditDrawer';

function formatHours(seconds: number): string {
  return (seconds / 3600).toFixed(2);
}

function formatTime(iso: string | null, tz?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });
}

function formatDate(iso: string, tz?: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(tz ? { timeZone: tz } : {}),
  });
}

export function TimesheetView({
  data,
  onRequestCorrection,
  onEditEntry,
  onDeleteEntry,
}: {
  data: TimesheetResponse;
  onRequestCorrection?: (entry: TimeEntry) => void;
  /** Supervisor/admin inline edit. When present, renders "Edit" in each
   *  row's actions so long as the entry isn't approved. */
  onEditEntry?: (entry: TimeEntry) => void;
  /** Supervisor/admin soft-delete. Same visibility rules as edit. */
  onDeleteEntry?: (entry: TimeEntry) => void;
}) {
  const [auditEntryId, setAuditEntryId] = useState<number | null>(null);

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
              {formatDate(data.period.start)} → {formatDate(data.period.end)} ·{' '}
              {data.period.type.replace('_', '-')}
            </p>
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
          <Total label="Regular" value={formatHours(data.totals.regularSeconds)} unit="hrs" />
          <Total
            label="Overtime"
            value={formatHours(data.totals.overtimeSeconds)}
            unit="hrs"
            highlight={data.totals.overtimeSeconds > 0}
          />
          <Total label="Break" value={formatHours(data.totals.breakSeconds)} unit="hrs" />
          <Total label="Total" value={formatHours(data.totals.workSeconds)} unit="hrs" />
        </dl>
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
                  {new Date(day.date + 'T12:00:00Z').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
              <p className="text-xs text-slate-500">
                Work {formatHours(day.workSeconds)} hrs · Break {formatHours(day.breakSeconds)} hrs
              </p>
            </header>
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-white text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2 text-left font-medium">Type</th>
                  <th className="px-5 py-2 text-left font-medium">Start</th>
                  <th className="px-5 py-2 text-left font-medium">End</th>
                  <th className="px-5 py-2 text-left font-medium">Duration</th>
                  <th className="px-5 py-2 text-left font-medium">Source</th>
                  <th className="px-5 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dayEntries.map((e) => (
                  <tr key={e.id}>
                    <td className="px-5 py-2">
                      <span
                        className={
                          'rounded-full px-2 py-0.5 text-xs font-medium ' +
                          (e.entryType === 'work'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800')
                        }
                      >
                        {e.entryType}
                      </span>
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-slate-700">
                      {formatTime(e.startedAt)}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-slate-700">
                      {e.endedAt ? (
                        formatTime(e.endedAt)
                      ) : (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          OPEN
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-2 font-mono text-xs text-slate-700">
                      {e.durationSeconds != null ? formatHours(e.durationSeconds) + 'h' : '—'}
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
                        {onRequestCorrection && !e.approvedAt && (
                          <button
                            type="button"
                            className="text-slate-700 hover:underline"
                            onClick={() => onRequestCorrection(e)}
                          >
                            Request fix
                          </button>
                        )}
                        {onEditEntry && !e.approvedAt && (
                          <button
                            type="button"
                            className="text-slate-900 hover:underline"
                            onClick={() => onEditEntry(e)}
                          >
                            Edit
                          </button>
                        )}
                        {onDeleteEntry && !e.approvedAt && (
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
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {auditEntryId != null && (
        <EntryAuditDrawer
          companyId={data.employee.companyId}
          entryId={auditEntryId}
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

export { formatHours, formatTime, formatDate };
