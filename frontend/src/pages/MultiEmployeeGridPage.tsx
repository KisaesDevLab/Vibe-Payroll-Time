// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MultiEmployeeDayCell, MultiEmployeeRow, TimeFormat } from '@vibept/shared';
import { formatHours } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { Drawer } from '../components/Drawer';
import { FormatToggle } from '../components/FormatToggle';
import { TopBar } from '../components/TopBar';
import { ApiError } from '../lib/api';
import { grids, timesheets, userPreferences } from '../lib/resources';

type FilterChip = 'all' | 'pending' | 'exceptions' | 'manual' | 'approved';

/**
 * Manager-focused grid: all employees × 7 days. Rows summarise each
 * employee's week; cells show day totals with exception/manual dots.
 * Clicking an employee row deep-links to their weekly grid.
 */
export function MultiEmployeeGridPage(): JSX.Element {
  const { companyId: companyIdStr } = useParams<{ companyId: string }>();
  const companyId = Number(companyIdStr);
  const [search, setSearch] = useSearchParams();
  const qc = useQueryClient();
  const [drilldown, setDrilldown] = useState<{
    row: MultiEmployeeRow;
    day: MultiEmployeeDayCell;
  } | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<{
    employeeCount: number;
    entryCount: number;
  } | null>(null);

  const today = new Date();
  const defaultWeekStart = (() => {
    const d = new Date(today);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  })();
  const weekStart = search.get('week') ?? defaultWeekStart;
  const [filter, setFilter] = useState<FilterChip>('all');

  const gridQ = useQuery({
    queryKey: ['multi-grid', companyId, weekStart],
    queryFn: () => grids.multi(companyId, weekStart),
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
      qc.invalidateQueries({ queryKey: ['multi-grid'] });
    },
  });

  function gotoWeek(delta: number) {
    const d = new Date(weekStart + 'T00:00:00');
    d.setDate(d.getDate() + delta * 7);
    const next = d.toISOString().slice(0, 10);
    search.set('week', next);
    setSearch(search);
  }

  const approveAllClean = useMutation({
    mutationFn: async () => {
      const grid = gridQ.data;
      if (!grid) throw new Error('no grid');
      const clean = grid.rows.filter(
        (r) => !r.hasPending && !r.allApproved && !r.days.some((d) => d.hasException),
      );
      if (clean.length === 0) {
        setApproveResult({ employeeCount: 0, entryCount: 0 });
        return;
      }
      const startIso = new Date(grid.week.start + 'T00:00:00Z').toISOString();
      const endIso = new Date(grid.week.end + 'T23:59:59Z').toISOString();
      const res = await timesheets.approve(companyId, {
        employeeIds: clean.map((r) => r.id),
        periodStart: startIso,
        periodEnd: endIso,
      });
      setApproveResult({
        employeeCount: res.affectedEmployeeIds.length,
        entryCount: res.approvedEntryCount,
      });
    },
    onSuccess: () => {
      setApproveError(null);
      qc.invalidateQueries({ queryKey: ['multi-grid'] });
    },
    onError: (err) => {
      setApproveError(err instanceof ApiError ? err.message : 'Approve-all failed');
    },
  });

  const rows = useMemo(() => {
    const all = gridQ.data?.rows ?? [];
    switch (filter) {
      case 'pending':
        return all.filter((r) => r.hasPending);
      case 'exceptions':
        return all.filter((r) => r.days.some((d) => d.hasException));
      case 'manual':
        return all.filter((r) => r.days.some((d) => d.hasManual));
      case 'approved':
        return all.filter((r) => r.allApproved);
      default:
        return all;
    }
  }, [gridQ.data, filter]);

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
        <main className="p-6 text-sm text-red-600">Failed to load grid.</main>
      </>
    );
  }

  const grid = gridQ.data;
  const dayHeaders = grid.dailyTotals.map((d) => ({
    date: d.date,
    dow: new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }),
    dom: new Date(d.date + 'T00:00:00').getDate(),
    total: d.seconds,
    isWeekend: [0, 6].includes(new Date(d.date + 'T00:00:00').getDay()),
    isToday: d.date === new Date().toISOString().slice(0, 10),
  }));

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              All employees · Week of {grid.week.start}
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              {grid.stats.employeeCount} employees ·{' '}
              <span className="font-semibold">
                {formatHours(grid.stats.regularSeconds, format)}
              </span>{' '}
              regular ·{' '}
              <span className="font-semibold text-amber-700">
                {formatHours(grid.stats.overtimeSeconds, format)}
              </span>{' '}
              OT · {grid.stats.cellsNeedingReview} cells need review
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FormatToggle
              value={format}
              onChange={(next) => updatePref.mutate(next)}
              disabled={updatePref.isPending}
              size="sm"
            />
            <Button
              onClick={() => approveAllClean.mutate()}
              loading={approveAllClean.isPending}
              disabled={approveAllClean.isPending}
            >
              Approve all clean
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

        {approveResult && (
          <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Approved {approveResult.entryCount} entries across {approveResult.employeeCount}{' '}
            employee(s).
          </div>
        )}
        {approveError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {approveError}
          </div>
        )}

        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', 'pending', 'exceptions', 'manual', 'approved'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                'rounded-full border px-3 py-1 text-xs uppercase tracking-wider transition ' +
                (filter === f
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
              }
            >
              {f}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full border-separate border-spacing-0">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-slate-500">
                <th className="sticky left-0 z-10 border-b border-slate-200 bg-white px-4 py-3 text-left">
                  Employee
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
                  </th>
                ))}
                <th className="border-b border-l border-slate-200 px-3 py-3 text-right">Week</th>
                <th className="border-b border-l border-slate-200 px-3 py-3 text-right">OT</th>
                <th className="border-b border-l border-slate-200 px-3 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-slate-50">
                  <th className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-3 text-left">
                    <a
                      href={`/companies/${companyId}/timesheets/${r.id}/week?start=${weekStart}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group block"
                    >
                      <div className="text-sm font-medium text-slate-900 group-hover:underline">
                        {r.firstName} {r.lastName}
                      </div>
                      <div className="text-xs text-slate-500">ID {r.id} · open in new tab ↗</div>
                    </a>
                  </th>
                  {r.days.map((d) => (
                    <DayCell
                      key={d.date}
                      day={d}
                      format={format}
                      onClick={() => setDrilldown({ row: r, day: d })}
                    />
                  ))}
                  <td className="border-b border-l border-slate-100 px-3 py-3 text-right font-mono text-sm text-slate-900">
                    {r.weekSeconds > 0 ? formatHours(r.weekSeconds, format) : '—'}
                  </td>
                  <td className="border-b border-l border-slate-100 px-3 py-3 text-right font-mono text-sm text-amber-700">
                    {r.overtimeSeconds > 0 ? formatHours(r.overtimeSeconds, format) : '—'}
                  </td>
                  <td className="border-b border-l border-slate-100 px-3 py-3 text-center text-xs">
                    {r.allApproved ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">
                        APPROVED
                      </span>
                    ) : r.hasPending ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-800">
                        PENDING
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <th className="sticky left-0 z-10 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-600">
                  Daily totals
                </th>
                {dayHeaders.map((d) => (
                  <td
                    key={d.date}
                    className="border-l border-slate-200 bg-slate-50 px-2 py-3 text-center font-mono text-sm text-slate-900"
                  >
                    {d.total > 0 ? formatHours(d.total, format) : '—'}
                  </td>
                ))}
                <td className="border-l border-slate-200 bg-slate-50 px-3 py-3 text-right font-mono text-base font-semibold text-slate-900">
                  {formatHours(grid.grandTotalSeconds, format)}
                </td>
                <td className="border-l border-slate-200 bg-slate-50" />
                <td className="border-l border-slate-200 bg-slate-50" />
              </tr>
            </tbody>
          </table>
        </div>
      </main>

      {drilldown && (
        <Drawer
          open
          onClose={() => setDrilldown(null)}
          title={`${drilldown.row.firstName} ${drilldown.row.lastName} · ${new Date(
            drilldown.day.date + 'T00:00:00',
          ).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}`}
        >
          <div className="flex flex-col gap-3 text-sm">
            <KV label="Total" value={formatHours(drilldown.day.seconds, format)} />
            <KV label="Has manual entry" value={drilldown.day.hasManual ? 'Yes' : 'No'} />
            <KV label="Has exception" value={drilldown.day.hasException ? 'Yes' : 'No'} />
            <KV label="Contributes to OT" value={drilldown.day.contributesToOT ? 'Yes' : 'No'} />
            <a
              href={`/companies/${companyId}/timesheets/${drilldown.row.id}/week?start=${weekStart}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Open full weekly grid ↗
            </a>
          </div>
        </Drawer>
      )}
    </>
  );
}

function KV({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 pb-1">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <span className="font-mono text-sm text-slate-900">{value}</span>
    </div>
  );
}

function DayCell({
  day,
  format,
  onClick,
}: {
  day: MultiEmployeeDayCell;
  format: TimeFormat;
  onClick: () => void;
}) {
  return (
    <td className="border-b border-l border-slate-100 p-0 text-center">
      <button
        type="button"
        onClick={onClick}
        className="w-full px-2 py-3 text-center hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        {day.seconds > 0 ? (
          <div
            className={
              'relative inline-block font-mono text-sm ' +
              (day.contributesToOT ? 'text-amber-700' : 'text-slate-900')
            }
          >
            {formatHours(day.seconds, format)}
            <div className="absolute -right-2 -top-1 flex gap-0.5">
              {day.hasException && (
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" title="Exception" />
              )}
              {day.hasManual && (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Has manual" />
              )}
            </div>
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </button>
    </td>
  );
}
