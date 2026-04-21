// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Employee, ReportColumn, ReportDefinition, ReportResult } from '@vibept/shared';
import { useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { employees as employeesApi, reports } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

export function ReportsPage() {
  const { companyId } = useOutletContext<CompanyContext>();

  const catalog = useQuery({
    queryKey: ['reports-catalog', companyId],
    queryFn: () => reports.catalog(companyId),
  });

  const [selected, setSelected] = useState<ReportDefinition | null>(null);
  const effective = selected ?? catalog.data?.[0] ?? null;

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Reports</h2>
        <p className="mb-3 text-xs text-slate-500">
          Run + export to CSV, or <strong>Print</strong> → "Save as PDF" for a shareable copy.
        </p>
        {catalog.isPending && <p className="text-xs text-slate-500">Loading…</p>}
        <ul className="flex flex-col gap-1">
          {catalog.data?.map((r) => (
            <li key={r.name}>
              <button
                type="button"
                onClick={() => setSelected(r)}
                className={
                  'w-full rounded-md px-3 py-2 text-left text-sm transition ' +
                  (effective?.name === r.name
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                <p className="font-medium">{r.label}</p>
                <p
                  className={
                    'mt-0.5 text-xs ' +
                    (effective?.name === r.name ? 'text-slate-300' : 'text-slate-500')
                  }
                >
                  {r.description}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section>
        {effective && (
          <ReportRunner companyId={companyId} report={effective} key={effective.name} />
        )}
      </section>
    </div>
  );
}

function ReportRunner({ companyId, report }: { companyId: number; report: ReportDefinition }) {
  const now = new Date();
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const firstOfNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();

  const defaults: Record<string, string> = {};
  for (const p of report.params) {
    if (p.type === 'date' && p.required) {
      if (p.key === 'periodStart') defaults[p.key] = firstOfMonth.slice(0, 10);
      else if (p.key === 'periodEnd') defaults[p.key] = firstOfNextMonth.slice(0, 10);
    }
  }
  const [form, setForm] = useState<Record<string, string>>(defaults);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());

  const roster = useQuery({
    queryKey: ['employees', companyId, 'all'],
    queryFn: () => employeesApi.list(companyId),
    enabled: report.params.some((p) => p.type === 'companyScoped'),
  });

  const run = useMutation({
    mutationFn: () => reports.run(companyId, report.name, queryForApi(form)),
  });

  const canRun = report.params.every((p) => !p.required || !!form[p.key]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{report.label}</h1>
          <p className="mt-1 text-sm text-slate-600">{report.description}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!run.data} onClick={() => window.print()}>
            Print / PDF
          </Button>
          <CsvDownloadButton
            companyId={companyId}
            name={report.name}
            params={queryForApi(form)}
            disabled={!canRun}
          />
        </div>
      </header>

      <form
        className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (canRun) run.mutate();
        }}
      >
        {report.params.map((p) => (
          <ParamInput
            key={p.key}
            field={p}
            value={form[p.key] ?? ''}
            roster={roster.data ?? []}
            onChange={(v) => setForm((f) => ({ ...f, [p.key]: v }))}
          />
        ))}
        <Button type="submit" disabled={!canRun} loading={run.isPending}>
          Run report
        </Button>
      </form>

      {run.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {run.error instanceof ApiError ? run.error.message : 'Report failed.'}
        </div>
      )}

      {run.data && (
        <ResultTable
          result={run.data}
          hiddenColumns={hiddenColumns}
          onToggle={(key) =>
            setHiddenColumns((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
        />
      )}
    </div>
  );
}

function ParamInput({
  field,
  value,
  roster,
  onChange,
}: {
  field: ReportDefinition['params'][number];
  value: string;
  roster: Employee[];
  onChange: (v: string) => void;
}) {
  if (field.type === 'companyScoped') {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">{field.label}</span>
        <select
          required={field.required}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{field.required ? 'Select employee…' : 'All employees'}</option>
          {roster.map((e) => (
            <option key={e.id} value={e.id}>
              {e.lastName}, {e.firstName}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.type === 'enum') {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">{field.label}</span>
        <select
          required={field.required}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {(field.choices ?? []).map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-slate-700">{field.label}</span>
      <input
        type="date"
        required={field.required}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * Convert the form's date-strings to ISO datetime the server expects
 * and drop empty optional fields. Date-only values become UTC midnight.
 */
function queryForApi(form: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (!v) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      out[k] = new Date(v + 'T00:00:00Z').toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

function ResultTable({
  result,
  hiddenColumns,
  onToggle,
}: {
  result: ReportResult;
  hiddenColumns: Set<string>;
  onToggle: (key: string) => void;
}) {
  const visible = useMemo(
    () => result.columns.filter((c) => !hiddenColumns.has(c.key)),
    [result.columns, hiddenColumns],
  );

  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
        <p>
          {result.rowCount} row{result.rowCount === 1 ? '' : 's'} · generated{' '}
          {new Date(result.generatedAt).toLocaleTimeString()}
        </p>
        <details className="relative">
          <summary className="cursor-pointer text-slate-700 hover:underline">Columns</summary>
          <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
            {result.columns.map((c) => (
              <label
                key={c.key}
                className="flex items-center gap-2 rounded px-2 py-1 text-slate-700 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={!hiddenColumns.has(c.key)}
                  onChange={() => onToggle(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </details>
      </header>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-white text-xs uppercase text-slate-500">
            <tr>
              {visible.map((c) => (
                <th
                  key={c.key}
                  className={
                    'px-4 py-2 font-medium ' +
                    (c.type === 'hours' || c.type === 'number' ? 'text-right' : 'text-left')
                  }
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {result.rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50">
                {visible.map((c) => (
                  <td
                    key={c.key}
                    className={
                      'px-4 py-2 ' +
                      (c.type === 'hours' || c.type === 'number'
                        ? 'text-right font-mono'
                        : 'text-slate-800')
                    }
                  >
                    {formatCell(row[c.key], c)}
                  </td>
                ))}
              </tr>
            ))}
            {result.rows.length === 0 && (
              <tr>
                <td
                  colSpan={visible.length}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No rows.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatCell(v: unknown, column: ReportColumn): string {
  if (v === null || v === undefined) return '';
  if (column.type === 'hours' && typeof v === 'number') return (v / 3600).toFixed(2);
  if (column.type === 'datetime' && typeof v === 'string') return new Date(v).toLocaleString();
  if (column.type === 'date' && typeof v === 'string')
    return new Date(v + 'T12:00:00Z').toLocaleDateString();
  if (column.type === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

/**
 * CSV download needs the bearer token attached; the browser's native
 * anchor download doesn't carry the Authorization header. We fetch the
 * stream ourselves (apiFetch bypassed so we get the raw Response) and
 * hand the resulting Blob to a temp anchor.
 */
function CsvDownloadButton({
  companyId,
  name,
  params,
  disabled,
}: {
  companyId: number;
  name: string;
  params: Record<string, string>;
  disabled: boolean;
}) {
  const download = useMutation({
    mutationFn: async () => {
      const url = reports.csvUrl(companyId, name, params);
      const session = authStore.get();
      const res = await fetch(url, {
        headers: session ? { authorization: `Bearer ${session.accessToken}` } : {},
        credentials: 'include',
      });
      if (!res.ok) {
        // Use apiFetch's error envelope if possible
        await apiFetch(`/companies/${companyId}/reports/${name}?` + new URLSearchParams(params), {
          method: 'GET',
        });
        throw new Error(`CSV download failed: ${res.status}`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] ?? `report-${name}.csv`;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
    },
  });

  return (
    <Button
      variant="secondary"
      onClick={() => download.mutate()}
      disabled={disabled}
      loading={download.isPending}
    >
      Download CSV
    </Button>
  );
}
