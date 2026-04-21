// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PayrollExport,
  PayrollFormat,
  PreflightResponse,
  RunExportRequest,
} from '@vibept/shared';
import { GENERIC_COLUMN_KEYS, type GenericColumnKey } from '@vibept/shared';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { payrollExports } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

const FORMAT_LABELS: Record<PayrollFormat, string> = {
  payroll_relief: 'Payroll Relief',
  gusto: 'Gusto',
  qbo_payroll: 'QBO Payroll',
  generic_csv: 'Generic CSV',
};

export function PayrollExportsPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();
  const today = new Date();
  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const firstOfNext = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const [periodStart, setPeriodStart] = useState(firstOfMonth.toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(firstOfNext.toISOString().slice(0, 10));
  const [runOpen, setRunOpen] = useState<{
    format: PayrollFormat;
    preflight: PreflightResponse;
  } | null>(null);

  const preflight = useMutation({
    mutationFn: () =>
      payrollExports.preflight(companyId, {
        periodStart: new Date(periodStart + 'T00:00:00Z').toISOString(),
        periodEnd: new Date(periodEnd + 'T00:00:00Z').toISOString(),
      }),
  });

  const history = useQuery({
    queryKey: ['payroll-exports', companyId],
    queryFn: () => payrollExports.history(companyId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['payroll-exports', companyId] });

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Run an export</h2>
        <p className="mt-1 text-sm text-slate-600">
          Every export starts with a preflight. Payroll destinations don't tolerate half-finished
          pay periods — the server refuses if any entry is still open or unapproved.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Period start</span>
            <input
              type="date"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Period end</span>
            <input
              type="date"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </label>
          <Button loading={preflight.isPending} onClick={() => preflight.mutate()}>
            Run preflight
          </Button>
        </div>

        {preflight.isError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {preflight.error instanceof ApiError ? preflight.error.message : 'Preflight failed.'}
          </div>
        )}

        {preflight.data && (
          <PreflightPanel
            data={preflight.data}
            onRun={(format) => setRunOpen({ format, preflight: preflight.data! })}
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Export history</h2>
        <HistoryTable companyId={companyId} data={history.data ?? []} loading={history.isPending} />
      </section>

      {runOpen && (
        <RunExportModal
          companyId={companyId}
          format={runOpen.format}
          preflight={runOpen.preflight}
          onClose={() => setRunOpen(null)}
          onComplete={() => {
            setRunOpen(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function PreflightPanel({
  data,
  onRun,
}: {
  data: PreflightResponse;
  onRun: (format: PayrollFormat) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-4">
      {data.ready ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Preflight green. {data.employees.length} employees ready to export.
        </div>
      ) : (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-semibold">Preflight blocked:</p>
          <ul className="mt-1 list-disc pl-5">
            {data.blockingIssues.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Employee</th>
              <th className="px-4 py-2 text-left font-medium">Approved</th>
              <th className="px-4 py-2 text-left font-medium">Open entry</th>
              <th className="px-4 py-2 text-left font-medium">Pending fix</th>
              <th className="px-4 py-2 text-right font-medium">Work hrs</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.employees.map((e) => (
              <tr key={e.employeeId}>
                <td className="px-4 py-2 text-slate-900">
                  {e.lastName}, {e.firstName}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge ok={e.allApproved} okLabel="yes" failLabel="no" />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge
                    ok={!e.hasOpenEntry}
                    okLabel="closed"
                    failLabel="OPEN"
                    failTone="red"
                  />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge
                    ok={!e.hasPendingCorrection}
                    okLabel="clear"
                    failLabel="pending"
                    failTone="amber"
                  />
                </td>
                <td className="px-4 py-2 text-right font-mono text-slate-800">
                  {(e.workSeconds / 3600).toFixed(2)}
                </td>
              </tr>
            ))}
            {data.employees.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                  No active employees.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data.priorExports.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">This period was already exported:</p>
          <ul className="mt-1">
            {data.priorExports.map((p) => (
              <li key={p.id}>
                #{p.id} · {FORMAT_LABELS[p.format]} · {new Date(p.exportedAt).toLocaleString()} by{' '}
                {p.exportedBy ?? 'system'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['payroll_relief', 'gusto', 'qbo_payroll', 'generic_csv'] as PayrollFormat[]).map(
          (fmt) => (
            <Button
              key={fmt}
              variant={fmt === 'generic_csv' ? 'secondary' : 'primary'}
              disabled={!data.ready}
              onClick={() => onRun(fmt)}
            >
              Export → {FORMAT_LABELS[fmt]}
            </Button>
          ),
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  ok,
  okLabel,
  failLabel,
  failTone,
}: {
  ok: boolean;
  okLabel: string;
  failLabel: string;
  failTone?: 'red' | 'amber';
}) {
  if (ok) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        {okLabel}
      </span>
    );
  }
  const cls =
    failTone === 'red'
      ? 'bg-red-100 text-red-800'
      : failTone === 'amber'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-slate-200 text-slate-700';
  return <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + cls}>{failLabel}</span>;
}

function RunExportModal({
  companyId,
  format,
  preflight,
  onClose,
  onComplete,
}: {
  companyId: number;
  format: PayrollFormat;
  preflight: PreflightResponse;
  onClose: () => void;
  onComplete: () => void;
}) {
  const hasPrior = preflight.priorExports.some((p) => p.format === format);
  const [notes, setNotes] = useState('');
  const [ack, setAck] = useState(false);
  const [genericCols, setGenericCols] = useState<Set<GenericColumnKey>>(
    new Set<GenericColumnKey>([
      'employee_number',
      'last_name',
      'first_name',
      'regular_hours',
      'overtime_hours',
      'total_hours',
    ]),
  );

  const run = useMutation({
    mutationFn: (): Promise<PayrollExport> => {
      const body: RunExportRequest = {
        format,
        periodStart: preflight.periodStart,
        periodEnd: preflight.periodEnd,
        acknowledgeReExport: ack,
        ...(notes ? { notes } : {}),
        ...(format === 'generic_csv' ? { genericColumns: [...genericCols] } : {}),
      };
      return payrollExports.run(companyId, body);
    },
    onSuccess: onComplete,
  });

  const disabled = (hasPrior && !ack) || (format === 'generic_csv' && genericCols.size === 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Export → ${FORMAT_LABELS[format]}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={disabled} loading={run.isPending} onClick={() => run.mutate()}>
            Run export
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {hasPrior && (
          <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />
            <span>
              This period was already exported in this format. I understand a new export will
              supersede the prior one (the old file remains available for download).
            </span>
          </label>
        )}

        {format === 'generic_csv' && (
          <fieldset className="rounded-md border border-slate-200 p-3 text-sm">
            <legend className="px-2 text-xs font-medium uppercase text-slate-500">
              Columns (order follows the list below)
            </legend>
            <div className="grid grid-cols-2 gap-1">
              {GENERIC_COLUMN_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={genericCols.has(key)}
                    onChange={() =>
                      setGenericCols((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  />
                  <code className="text-xs">{key}</code>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Note (optional)</span>
          <textarea
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Mid-pay-period corrections for Smith"
          />
        </label>

        {run.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {run.error instanceof ApiError ? run.error.message : 'Export failed.'}
          </div>
        )}
      </div>
    </Modal>
  );
}

function HistoryTable({
  companyId,
  data,
  loading,
}: {
  companyId: number;
  data: PayrollExport[];
  loading: boolean;
}) {
  const download = (id: number) => {
    const url = payrollExports.downloadUrl(companyId, id);
    const session = authStore.get();
    // Native <a download> can't carry the bearer token; fetch → blob → save.
    void (async () => {
      const res = await fetch(url, {
        headers: session ? { authorization: `Bearer ${session.accessToken}` } : {},
        credentials: 'include',
      });
      if (!res.ok) {
        alert(`Download failed: ${res.status}`);
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') ?? '';
      const match = cd.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] ?? `export-${id}.csv`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    })();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-4 py-2 text-left font-medium">When</th>
            <th className="px-4 py-2 text-left font-medium">Format</th>
            <th className="px-4 py-2 text-left font-medium">Period</th>
            <th className="px-4 py-2 text-right font-medium">Employees</th>
            <th className="px-4 py-2 text-right font-medium">Total hrs</th>
            <th className="px-4 py-2 text-left font-medium">By</th>
            <th className="px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                Loading…
              </td>
            </tr>
          )}
          {!loading &&
            data.map((e) => (
              <tr key={e.id} className={e.replacedById ? 'text-slate-400' : ''}>
                <td className="px-4 py-2">{new Date(e.exportedAt).toLocaleString()}</td>
                <td className="px-4 py-2">{FORMAT_LABELS[e.format]}</td>
                <td className="px-4 py-2 text-xs">
                  {new Date(e.periodStart).toISOString().slice(0, 10)} →{' '}
                  {new Date(e.periodEnd).toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2 text-right font-mono">{e.employeeCount}</td>
                <td className="px-4 py-2 text-right font-mono">
                  {(e.totalWorkSeconds / 3600).toFixed(2)}
                </td>
                <td className="px-4 py-2 text-xs">{e.exportedByEmail ?? '—'}</td>
                <td className="px-4 py-2 text-right">
                  {e.replacedById ? (
                    <span className="text-xs italic">superseded by #{e.replacedById}</span>
                  ) : (
                    <button
                      type="button"
                      className="text-sm font-medium text-slate-900 hover:underline"
                      onClick={() => download(e.id)}
                    >
                      Download
                    </button>
                  )}
                </td>
              </tr>
            ))}
          {!loading && data.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500">
                No exports yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
