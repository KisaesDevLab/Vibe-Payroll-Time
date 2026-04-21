// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { UpdateCard } from '../components/UpdateCard';
import { authStore } from '../lib/auth-store';
import { admin } from '../lib/resources';

/**
 * SuperAdmin appliance health dashboard. Snapshot view — one call to
 * /admin/health and everything the operator needs to know whether the
 * box is healthy.
 */
export function ApplianceHealthPage() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin-health'],
    queryFn: admin.health,
    refetchInterval: 30_000,
  });

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Appliance</h1>
            <p className="mt-1 text-sm text-slate-600">
              Snapshot of the running appliance. Auto-refreshes every 30 seconds.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/appliance/settings"
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
            >
              Settings
            </Link>
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
              onClick={() => refetch()}
            >
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </header>

        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to load health snapshot.
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-6">
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card label="Version">
                <p className="font-mono text-slate-900">{data.appliance.version}</p>
                <p className="text-xs text-slate-500">git {data.appliance.gitSha.slice(0, 7)}</p>
              </Card>
              <Card label="Database">
                <p className={data.checks.db === 'ok' ? 'text-emerald-700' : 'text-red-700'}>
                  {data.checks.db === 'ok' ? 'connected' : 'unreachable'}
                </p>
              </Card>
              <Card label="Licensing">
                <p className="text-slate-900">
                  {data.checks.licensingEnforced ? 'enforced' : 'off (pre-live)'}
                </p>
              </Card>
              <Card label="Open punches">
                <p className="font-mono text-2xl text-slate-900">{data.runtime.openTimeEntries}</p>
                <p className="text-xs text-slate-500">employees currently on the clock</p>
              </Card>
            </section>

            <UpdateCard />

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Companies</h2>
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">License</th>
                    <th className="py-2 text-right font-medium">Employees</th>
                    <th className="py-2 text-right font-medium">Export</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.companies.map((c) => (
                    <tr key={c.id}>
                      <td className="py-2">
                        <span className="font-medium text-slate-900">{c.name}</span>
                        <span className="ml-2 text-xs text-slate-500">{c.slug}</span>
                      </td>
                      <td className="py-2 text-slate-700">
                        {c.isInternal ? 'Internal' : 'Client'}
                      </td>
                      <td className="py-2 text-slate-700">{c.licenseState.replace('_', ' ')}</td>
                      <td className="py-2 text-right font-mono">{c.employeeCount}</td>
                      <td className="py-2 text-right">
                        <ExportZipButton companyId={c.id} companySlug={c.slug} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="mb-3 text-base font-semibold text-slate-900">Notifications (24h)</h2>
              {Object.keys(data.runtime.notifications24h).length === 0 ? (
                <p className="text-sm text-slate-500">
                  No notifications sent in the last 24 hours.
                </p>
              ) : (
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-4">
                  {Object.entries(data.runtime.notifications24h).map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between">
                      <dt className="text-slate-600">{status}</dt>
                      <dd className="font-mono text-slate-900">{count}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>

            <p className="text-xs text-slate-500">
              Snapshot taken {new Date(data.timestamp).toLocaleString()} —{' '}
              <span className="font-mono">{data.appliance.id}</span>
            </p>
          </div>
        )}
      </main>
    </>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-widest text-slate-500">{label}</p>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}

function ExportZipButton({ companyId, companySlug }: { companyId: number; companySlug: string }) {
  // Bearer-header fetch → Blob → trigger <a download>. The endpoint
  // requires requireAuth, so a plain <a href> would 401 silently.
  const [err, setErr] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const session = authStore.get();
      if (!session) throw new Error('Not signed in');
      const url = admin.exportCompanyUrl(companyId);
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `vibept-${companySlug}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Export failed'),
    onSuccess: () => setErr(null),
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="text-sm font-medium text-slate-900 hover:underline disabled:opacity-60"
        onClick={() => run.mutate()}
        disabled={run.isPending}
      >
        {run.isPending ? 'Preparing…' : 'ZIP →'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
