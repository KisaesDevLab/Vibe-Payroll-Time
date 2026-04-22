// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TimeEntry, TimeFormat, WeeklyGridCell } from '@vibept/shared';
import { formatHours } from '@vibept/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AddJobPicker } from '../components/AddJobPicker';
import { Button } from '../components/Button';
import { CellEditPopover } from '../components/CellEditPopover';
import { FormatToggle } from '../components/FormatToggle';
import { HoursCell } from '../components/HoursCell';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import {
  employees as employeesApi,
  grids,
  manualEntries,
  timesheets,
  userPreferences,
} from '../lib/resources';

const UNDO_WINDOW_MS = 60_000;

/**
 * Weekly grid for one employee. Shows jobs as rows, days as columns, a
 * "no job" row for ungeared manual entries, plus a total column.
 *
 * Every cell opens the CellEditPopover when clicked. Save path always
 * creates or updates a `web_manual` entry (which supersedes punches if
 * any exist). Delete on a manual cell restores superseded punches.
 */
export function WeeklyGridPage(): JSX.Element {
  const params = useParams<{ companyId: string; employeeId: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const [search, setSearch] = useSearchParams();
  const companyId = Number(params.companyId);
  const employeeId = Number(params.employeeId);

  // Managers and admins get an employee picker so they can page through
  // the roster without bouncing to the TimesheetsReviewPage. An employee
  // viewing their own grid just sees a static name.
  const membership = session?.user.memberships.find((m) => m.companyId === companyId);
  const isManager =
    session?.user.roleGlobal === 'super_admin' ||
    membership?.role === 'company_admin' ||
    membership?.role === 'supervisor';
  const rosterQ = useQuery({
    queryKey: ['roster', companyId],
    queryFn: () => employeesApi.list(companyId),
    enabled: isManager,
    staleTime: 60_000,
  });
  const today = new Date();
  const dow = today.getDay(); // 0=Sun
  const defaultWeekStart = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - dow); // Sunday-anchored default
    return d.toISOString().slice(0, 10);
  })();
  const weekStart = search.get('start') ?? defaultWeekStart;
  const qc = useQueryClient();

  const [editing, setEditing] = useState<{
    jobId: number | null;
    date: string;
    jobLabel: string;
    mode: 'add' | 'edit' | 'override';
    initialSeconds: number | null;
    initialReason: string;
    manualEntryId: number | null;
    originalPunchText: string | null;
  } | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastSaveFailed, setLastSaveFailed] = useState(false);
  const [tickTock, setTickTock] = useState(0);

  // Job-row filtering. At a company with 30+ active jobs the default
  // "render every job as a row" makes the grid a long, sparse,
  // mostly-empty table that's hostile on mobile and not great on
  // desktop. Default to showing only jobs with activity this week
  // (plus session-pinned ones), with a one-tap chip to see the full
  // list for the admin who wants it. Persisted per device, per
  // company — it's a display habit, not a business rule.
  const jobFilterStorageKey = `vibept.weeklyGrid.jobFilter.${companyId}`;
  const [jobFilter, setJobFilter] = useState<'active' | 'all'>(() => {
    if (typeof window === 'undefined') return 'active';
    const stored = window.localStorage.getItem(jobFilterStorageKey);
    return stored === 'all' ? 'all' : 'active';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(jobFilterStorageKey, jobFilter);
  }, [jobFilter, jobFilterStorageKey]);
  const [jobSearch, setJobSearch] = useState('');
  // Session-only pin set. When the user clicks "+ Add job" and picks
  // a job that had no hours this week yet, we add it here so the row
  // stays visible even before they save. If they do save, the job's
  // entry in grid.jobTotals will be > 0 on the next refetch and the
  // active-this-week rule picks it up naturally; pin becomes
  // redundant and cheap to drop on component unmount.
  const [pinnedJobIds, setPinnedJobIds] = useState<Set<number>>(new Set());
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [undo, setUndo] = useState<
    | { kind: 'created'; entryId: number; companyId: number; at: number }
    | {
        kind: 'updated';
        entryId: number;
        companyId: number;
        prior: { seconds: number; reason: string };
        at: number;
      }
    | {
        kind: 'deleted';
        snapshot: { day: string; jobId: number | null; seconds: number; reason: string };
        at: number;
      }
    | null
  >(null);

  // 1-second ticker so the "Saved 4s ago" indicator counts up without
  // re-fetching anything.
  useEffect(() => {
    const id = window.setInterval(() => setTickTock((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const gridQ = useQuery({
    queryKey: ['weekly-grid', companyId, employeeId, weekStart],
    queryFn: () => grids.weekly(companyId, employeeId, weekStart),
  });

  const prefsQ = useQuery({
    queryKey: ['me-prefs'],
    queryFn: () => userPreferences.get(),
  });

  const format: TimeFormat =
    gridQ.data?.timeFormat ?? prefsQ.data?.timeFormatEffective ?? 'decimal';

  const updatePref = useMutation({
    mutationFn: (next: TimeFormat) => userPreferences.update({ timeFormatPreference: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me-prefs'] });
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
    },
  });

  const saveCell = useMutation({
    mutationFn: async (input: { seconds: number; reason: string; typedInput: string }) => {
      if (!editing) return;
      if (editing.manualEntryId != null && editing.mode !== 'override') {
        return manualEntries.update(editing.manualEntryId, {
          companyId,
          durationSeconds: input.seconds,
          reason: input.reason,
          typedInput: input.typedInput,
        });
      }
      return manualEntries.create({
        companyId,
        employeeId,
        day: editing.date,
        jobId: editing.jobId,
        durationSeconds: input.seconds,
        reason: input.reason,
        typedInput: input.typedInput,
      });
    },
    onSuccess: (res) => {
      const wasUpdate = editing?.manualEntryId != null && editing.mode !== 'override';
      const priorSeconds = editing?.initialSeconds ?? 0;
      const priorReason = editing?.initialReason ?? '';
      if (res?.entry) {
        if (wasUpdate) {
          setUndo({
            kind: 'updated',
            entryId: res.entry.id,
            companyId,
            prior: { seconds: priorSeconds, reason: priorReason },
            at: Date.now(),
          });
        } else {
          setUndo({
            kind: 'created',
            entryId: res.entry.id,
            companyId,
            at: Date.now(),
          });
        }
      }
      setEditing(null);
      setErrorText(null);
      setLastSavedAt(Date.now());
      setLastSaveFailed(false);
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
    },
    onError: (err) => {
      setErrorText(err instanceof ApiError ? err.message : 'Save failed');
      setLastSaveFailed(true);
    },
  });

  const deleteCell = useMutation({
    mutationFn: async () => {
      if (!editing?.manualEntryId) return;
      await manualEntries.remove(editing.manualEntryId, {
        companyId,
        reason: 'Removed from weekly grid',
      });
    },
    onSuccess: () => {
      if (editing) {
        setUndo({
          kind: 'deleted',
          snapshot: {
            day: editing.date,
            jobId: editing.jobId,
            seconds: editing.initialSeconds ?? 0,
            reason: editing.initialReason || 'Restored from undo',
          },
          at: Date.now(),
        });
      }
      setEditing(null);
      setErrorText(null);
      setLastSavedAt(Date.now());
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
    },
    onError: (err) => {
      setErrorText(err instanceof ApiError ? err.message : 'Delete failed');
      setLastSaveFailed(true);
    },
  });

  const copyWeek = useMutation({
    mutationFn: (reason: string) =>
      manualEntries.copyLastWeek({ companyId, employeeId, weekStart, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
      setLastSavedAt(Date.now());
    },
    onError: (err) => {
      setErrorText(err instanceof ApiError ? err.message : 'Copy failed');
    },
  });

  const submitForApproval = useMutation({
    mutationFn: () => {
      const period = gridQ.data;
      if (!period) throw new Error('no grid data');
      // Use the week window itself as the "period" to approve. The
      // timesheets approve endpoint takes periodStart/End ISO.
      const startIso = new Date(period.week.start + 'T00:00:00Z').toISOString();
      const endIso = new Date(period.week.end + 'T23:59:59Z').toISOString();
      return timesheets.approve(companyId, {
        employeeIds: [employeeId],
        periodStart: startIso,
        periodEnd: endIso,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
      setLastSavedAt(Date.now());
    },
    onError: (err) => {
      setErrorText(err instanceof ApiError ? err.message : 'Submit failed');
    },
  });

  const undoMutation = useMutation({
    mutationFn: async () => {
      if (!undo) return;
      if (undo.kind === 'created') {
        await manualEntries.remove(undo.entryId, {
          companyId: undo.companyId,
          reason: 'Undo: remove just-created manual entry',
        });
      } else if (undo.kind === 'updated') {
        await manualEntries.update(undo.entryId, {
          companyId: undo.companyId,
          durationSeconds: undo.prior.seconds,
          reason: undo.prior.reason || 'Undo: revert to prior value',
        });
      } else if (undo.kind === 'deleted') {
        await manualEntries.create({
          companyId,
          employeeId,
          day: undo.snapshot.day,
          jobId: undo.snapshot.jobId,
          durationSeconds: undo.snapshot.seconds,
          reason: undo.snapshot.reason || 'Undo: restore deleted manual entry',
          typedInput: 'undo',
        });
      }
    },
    onSuccess: () => {
      setUndo(null);
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
    },
  });

  // Expire the undo toast after the window.
  useEffect(() => {
    if (!undo) return;
    const id = window.setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => window.clearTimeout(id);
  }, [undo]);

  const cellMap = useMemo(() => {
    const m = new Map<string, WeeklyGridCell>();
    for (const c of gridQ.data?.cells ?? []) {
      m.set(cellKey(c.jobId, c.date), c);
    }
    return m;
  }, [gridQ.data]);

  function gotoWeek(delta: number) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    const next = d.toISOString().slice(0, 10);
    search.set('start', next);
    setSearch(search);
  }

  if (gridQ.isLoading) {
    return (
      <>
        <TopBar />
        <main className="p-6 text-sm text-slate-500">Loading…</main>
      </>
    );
  }
  if (gridQ.error || !gridQ.data) {
    return (
      <>
        <TopBar />
        <main className="p-6 text-sm text-red-600">Failed to load weekly grid.</main>
      </>
    );
  }

  const grid = gridQ.data;
  const dayHeaders = grid.days.map((d) => ({
    date: d.date,
    dow: new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }),
    dom: new Date(d.date + 'T00:00:00').getDate(),
    totalSeconds: d.totalSeconds,
    hasException: d.hasException,
    hasManual: d.hasManual,
    isWeekend: [0, 6].includes(new Date(d.date + 'T00:00:00').getDay()),
    isToday: d.date === new Date().toISOString().slice(0, 10),
  }));

  // Row-visibility rule. Backend returns every active job; this is
  // where the client culls them down. `No job` (jobId = null) row
  // is unconditional — it carries ungeared manual entries and is
  // the fallback for "I worked something, not sure which job yet."
  const jobTotalsById = new Map(grid.jobTotals.map((t) => [t.jobId, t.seconds]));
  const searchLower = jobSearch.trim().toLowerCase();
  const baseSet =
    jobFilter === 'all'
      ? grid.jobs
      : grid.jobs.filter((j) => (jobTotalsById.get(j.id) ?? 0) > 0 || pinnedJobIds.has(j.id));
  const visibleJobs = searchLower
    ? baseSet.filter(
        (j) =>
          j.code.toLowerCase().includes(searchLower) || j.name.toLowerCase().includes(searchLower),
      )
    : baseSet;
  const jobRows = [...visibleJobs, { id: null, code: '—', name: 'No job', archivedAt: null }];

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              {isManager && (rosterQ.data?.length ?? 0) > 0 ? (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    Weekly grid ·
                  </h1>
                  <select
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-lg shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    value={employeeId}
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      navigate(
                        `/companies/${companyId}/timesheets/${nextId}/week?start=${grid.week.start}`,
                      );
                    }}
                  >
                    {rosterQ
                      .data!.slice()
                      .sort((a, b) => {
                        // Active first, then by last name. Keeps a picker useful
                        // when terminated employees are still in the list for
                        // historical grids.
                        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
                        return `${a.lastName} ${a.firstName}`.localeCompare(
                          `${b.lastName} ${b.firstName}`,
                        );
                      })
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.lastName}, {e.firstName}
                          {e.status !== 'active' ? ` (${e.status})` : ''}
                        </option>
                      ))}
                  </select>
                </>
              ) : (
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {grid.employee.firstName} {grid.employee.lastName} · Weekly grid
                </h1>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Week of <span className="font-mono">{grid.week.start}</span> —{' '}
              <span className="font-mono">{grid.week.end}</span> ·{' '}
              <span className="font-semibold">{formatHours(grid.weekTotalSeconds, format)}</span>{' '}
              total
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SaveIndicator lastSavedAt={lastSavedAt} failed={lastSaveFailed} tick={tickTock} />
            <FormatToggle
              value={format}
              onChange={(next) => updatePref.mutate(next)}
              disabled={updatePref.isPending}
              size="sm"
            />
            <Button
              variant="secondary"
              onClick={() => {
                const reason = window.prompt(
                  'Copy last week into this week. Reason (required):',
                  'Repeated from prior week',
                );
                if (reason?.trim()) copyWeek.mutate(reason.trim());
              }}
              loading={copyWeek.isPending}
              disabled={grid.allApproved}
            >
              Copy last week
            </Button>
            <Button
              onClick={() => submitForApproval.mutate()}
              loading={submitForApproval.isPending}
              disabled={grid.allApproved || grid.entries.length === 0}
            >
              Submit for approval
            </Button>
            <div className="flex items-center gap-1">
              <Button variant="secondary" onClick={() => gotoWeek(-1)}>
                ← Prev
              </Button>
              <Button variant="secondary" onClick={() => gotoWeek(1)}>
                Next →
              </Button>
            </div>
          </div>
        </header>

        {copyWeek.data && (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Copied {copyWeek.data.createdCount} cells from last week.
            {copyWeek.data.skippedCount > 0 &&
              ` Skipped ${copyWeek.data.skippedCount} day(s) that already had entries.`}
          </div>
        )}

        {/* Filter row — trims the job-row list on a by-default basis
            for companies with many jobs. See comments on jobFilter /
            pinnedJobIds state near the top of this component. Wraps
            on mobile via flex-wrap. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Job row visibility"
            className="inline-flex rounded-md border border-slate-300 bg-white text-sm shadow-sm"
          >
            <button
              type="button"
              role="tab"
              aria-selected={jobFilter === 'active'}
              onClick={() => setJobFilter('active')}
              className={
                'rounded-l-md px-3 py-2 font-medium transition ' +
                (jobFilter === 'active'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-50')
              }
            >
              Active this week
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={jobFilter === 'all'}
              onClick={() => setJobFilter('all')}
              className={
                'rounded-r-md border-l border-slate-300 px-3 py-2 font-medium transition ' +
                (jobFilter === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-50')
              }
            >
              All jobs
            </button>
          </div>
          <input
            type="search"
            placeholder="Filter jobs…"
            aria-label="Filter visible jobs"
            className="w-64 max-w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            value={jobSearch}
            onChange={(e) => setJobSearch(e.target.value)}
          />
          {jobFilter === 'active' && (
            <Button variant="secondary" onClick={() => setAddJobOpen(true)}>
              + Add job
            </Button>
          )}
          <span className="ml-auto text-xs text-slate-500">
            {visibleJobs.length} of {grid.jobs.length} job
            {grid.jobs.length === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-4 py-3 text-left">
                  Job
                </th>
                {dayHeaders.map((d) => (
                  <th
                    key={d.date}
                    className={
                      'border-b border-l border-slate-200 px-2 py-3 text-center ' +
                      (d.isWeekend ? 'bg-slate-50 ' : '') +
                      (d.isToday ? 'text-amber-700' : '')
                    }
                  >
                    <div>{d.dow}</div>
                    <div className="text-lg font-bold text-slate-900">{d.dom}</div>
                    <div className="mt-1 flex items-center justify-center gap-1">
                      {d.hasException && (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full bg-red-500"
                          title="Exception"
                        />
                      )}
                      {d.hasManual && (
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500"
                          title="Has manual"
                        />
                      )}
                    </div>
                  </th>
                ))}
                <th className="border-b border-l border-slate-200 px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {jobFilter === 'active' && visibleJobs.length === 0 && (
                // jobRows still carries the "No job" row below this, so
                // the week scaffolding (day header, daily totals) still
                // shows. This banner just replaces the lonely absence
                // of real-job rows with a usable call to action.
                <tr>
                  <td
                    colSpan={dayHeaders.length + 2}
                    className="border-b border-slate-100 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600"
                  >
                    No jobs have hours this week yet. Tap{' '}
                    <button
                      type="button"
                      onClick={() => setAddJobOpen(true)}
                      className="font-semibold text-slate-900 underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
                    >
                      + Add job
                    </button>{' '}
                    to log time on a job, or switch to{' '}
                    <button
                      type="button"
                      onClick={() => setJobFilter('all')}
                      className="font-semibold text-slate-900 underline decoration-slate-400 underline-offset-2 hover:decoration-slate-700"
                    >
                      All jobs
                    </button>{' '}
                    to see the full list.
                  </td>
                </tr>
              )}
              {jobRows.map((job) => {
                const jobTotal = grid.jobTotals.find((t) => t.jobId === job.id)?.seconds ?? 0;
                return (
                  <tr key={String(job.id)} className="align-top">
                    <th className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 text-left">
                      <div className="text-sm font-medium text-slate-900">{job.code}</div>
                      <div className="text-xs text-slate-500">{job.name}</div>
                    </th>
                    {dayHeaders.map((d) => {
                      const cell =
                        cellMap.get(cellKey(job.id, d.date)) ??
                        ({
                          jobId: job.id,
                          date: d.date,
                          seconds: 0,
                          sourceTag: 'none',
                          manualEntryId: null,
                          entryReason: null,
                          locked: false,
                        } satisfies WeeklyGridCell);
                      return (
                        <td
                          key={d.date}
                          className={
                            'border-b border-l border-slate-100 p-1 ' +
                            (d.isWeekend ? 'bg-slate-50/60 ' : '')
                          }
                        >
                          <HoursCell
                            seconds={cell.seconds}
                            format={format}
                            sourceTag={cell.sourceTag}
                            locked={cell.locked}
                            onClick={
                              cell.locked
                                ? undefined
                                : () => {
                                    setErrorText(null);
                                    setEditing({
                                      jobId: job.id,
                                      date: d.date,
                                      jobLabel: job.code + ' · ' + job.name,
                                      mode:
                                        cell.sourceTag === 'none'
                                          ? 'add'
                                          : cell.sourceTag === 'punched'
                                            ? 'override'
                                            : 'edit',
                                      initialSeconds: cell.seconds || null,
                                      initialReason: cell.entryReason ?? '',
                                      manualEntryId: cell.manualEntryId,
                                      originalPunchText:
                                        cell.sourceTag === 'punched'
                                          ? formatHours(cell.seconds, format)
                                          : null,
                                    });
                                  }
                            }
                          />
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-100 px-3 py-3 text-right font-mono text-sm text-slate-900">
                      {jobTotal > 0 ? formatHours(jobTotal, format) : '—'}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Daily total
                </th>
                {dayHeaders.map((d) => (
                  <td
                    key={d.date}
                    className={
                      'border-l border-slate-200 bg-slate-50 px-2 py-3 text-center font-mono text-sm text-slate-900 ' +
                      (d.isWeekend ? 'bg-slate-100/70' : '')
                    }
                  >
                    {d.totalSeconds > 0 ? formatHours(d.totalSeconds, format) : '—'}
                  </td>
                ))}
                <td className="border-l border-slate-200 bg-slate-50 px-3 py-3 text-right font-mono text-base font-semibold text-slate-900">
                  {formatHours(grid.weekTotalSeconds, format)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <ExceptionsPanel entries={grid.entries} />
      </main>

      {undo && (
        <UndoToast
          kind={undo.kind}
          onUndo={() => undoMutation.mutate()}
          onDismiss={() => setUndo(null)}
          pending={undoMutation.isPending}
        />
      )}

      {editing && (
        <CellEditPopover
          open={!!editing}
          onClose={() => {
            setEditing(null);
            setErrorText(null);
          }}
          mode={editing.mode}
          format={format}
          initialSeconds={editing.initialSeconds}
          initialReason={editing.initialReason}
          dayLabel={new Date(editing.date + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
          })}
          jobLabel={editing.jobLabel}
          originalPunchText={editing.originalPunchText}
          onSave={async (input) => {
            await saveCell.mutateAsync(input);
          }}
          onDelete={
            editing.manualEntryId
              ? async () => {
                  await deleteCell.mutateAsync();
                }
              : undefined
          }
          saving={saveCell.isPending || deleteCell.isPending}
          errorText={errorText}
        />
      )}

      <AddJobPicker
        open={addJobOpen}
        jobs={grid.jobs}
        // Exclude every job already showing as a row — the user already
        // has a cell for them. Pinned jobs are part of visibleJobs too.
        excludedIds={new Set(visibleJobs.map((j) => j.id))}
        onPick={(jobId) => {
          setAddJobOpen(false);
          setPinnedJobIds((prev) => {
            const next = new Set(prev);
            next.add(jobId);
            return next;
          });
          const picked = grid.jobs.find((j) => j.id === jobId);
          if (!picked) return;
          // Open the edit popover on the best default day: today if
          // it's inside the visible week, otherwise the first day of
          // the week. Same state shape the cell-click handler uses,
          // so CellEditPopover opens with no special branching.
          const todayIso = new Date().toISOString().slice(0, 10);
          const defaultDate = grid.days.some((d) => d.date === todayIso)
            ? todayIso
            : (grid.days[0]?.date ?? weekStart);
          setErrorText(null);
          setEditing({
            jobId: picked.id,
            date: defaultDate,
            jobLabel: picked.code + ' · ' + picked.name,
            mode: 'add',
            initialSeconds: null,
            initialReason: '',
            manualEntryId: null,
            originalPunchText: null,
          });
        }}
        onClose={() => setAddJobOpen(false)}
      />
    </>
  );
}

function cellKey(jobId: number | null, date: string): string {
  return `${jobId ?? '_'}|${date}`;
}

function SaveIndicator({
  lastSavedAt,
  failed,
  tick: _tick,
}: {
  lastSavedAt: number | null;
  failed: boolean;
  tick: number;
}): JSX.Element | null {
  if (lastSavedAt == null && !failed) return null;
  if (failed) {
    return (
      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
        Save failed
      </span>
    );
  }
  const seconds = Math.max(0, Math.floor((Date.now() - (lastSavedAt ?? Date.now())) / 1000));
  const label = seconds < 2 ? 'Saved just now' : `Saved ${seconds}s ago`;
  return (
    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
      {label}
    </span>
  );
}

function UndoToast({
  kind,
  onUndo,
  onDismiss,
  pending,
}: {
  kind: 'created' | 'updated' | 'deleted';
  onUndo: () => void;
  onDismiss: () => void;
  pending: boolean;
}): JSX.Element {
  const verb = kind === 'deleted' ? 'deleted' : kind === 'created' ? 'added' : 'updated';
  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white shadow-2xl">
      <span className="mr-4">Cell {verb}.</span>
      <button
        type="button"
        onClick={onUndo}
        disabled={pending}
        className="rounded px-2 py-0.5 text-xs uppercase tracking-wider text-amber-300 hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? 'Undoing…' : 'Undo'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-1 rounded px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800"
      >
        ✕
      </button>
    </div>
  );
}

function ExceptionsPanel({ entries }: { entries: TimeEntry[] }): JSX.Element | null {
  const exceptions = entries.filter((e) => !e.endedAt || e.isAutoClosed || e.sourceOffline);
  const [open, setOpen] = useState(false);
  if (exceptions.length === 0) return null;
  return (
    <section className="mt-6 rounded-lg border border-amber-200 bg-amber-50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
      >
        <div>
          <span className="text-sm font-semibold text-amber-900">
            Exceptions ({exceptions.length})
          </span>
          <span className="ml-3 text-xs text-amber-800">
            Open entries, auto-closed entries, and offline-queued punches.
          </span>
        </div>
        <span className="text-xs uppercase tracking-wider text-amber-800">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>
      {open && (
        <ul className="divide-y divide-amber-200 border-t border-amber-200 text-sm">
          {exceptions.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-4 px-4 py-2">
              <div>
                <div className="font-mono text-xs text-amber-900">
                  #{e.id} · {new Date(e.startedAt).toLocaleString()}
                </div>
                <div className="text-xs text-amber-800">
                  {e.entryType}
                  {e.jobId != null && ` · job ${e.jobId}`}
                  {!e.endedAt && ' · OPEN'}
                  {e.isAutoClosed && ' · AUTO-CLOSED'}
                  {e.sourceOffline && ' · OFFLINE'}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
