// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { companies as companiesApi } from '../lib/resources';

export function DashboardPage() {
  const session = useSession();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: companiesApi.list,
  });
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const filtered = useMemo(() => {
    const rows = companies.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (!showInactive && c.disabledAt) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q);
    });
  }, [companies.data, search, showInactive]);
  const hasAny = (companies.data?.length ?? 0) > 0;
  const inactiveCount = (companies.data ?? []).filter((c) => c.disabledAt).length;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Welcome{session?.user.email ? `, ${session.user.email}` : ''}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {companies.data?.length === 0
              ? 'No companies yet. Create one from "All companies".'
              : 'Pick a company to manage.'}
          </p>
        </header>

        {companies.isPending && <p className="text-sm text-slate-500">Loading companies…</p>}
        {companies.isError && (
          <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to load companies.
          </p>
        )}

        {hasAny && (
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input
              type="search"
              placeholder="Search companies…"
              className="w-full max-w-sm rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {inactiveCount > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                />
                Show inactive ({inactiveCount})
              </label>
            )}
            {search && (
              <span className="text-xs text-slate-500">
                {filtered.length} of {companies.data?.length ?? 0}
              </span>
            )}
          </div>
        )}

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="group flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{c.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{c.slug}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.isInternal && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Internal
                    </span>
                  )}
                  {c.disabledAt && (
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase text-slate-700">
                      Inactive
                    </span>
                  )}
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-xs text-slate-600">
                <dt>Pay period</dt>
                <dd className="text-right font-medium text-slate-800">
                  {c.payPeriodType.replace('_', '-')}
                </dd>
                <dt>Timezone</dt>
                <dd className="text-right font-medium text-slate-800">{c.timezone}</dd>
                <dt>Employees</dt>
                <dd className="text-right font-medium text-slate-800">
                  {c.employeeCount ?? 0} active
                </dd>
                <dt>License</dt>
                <dd className="text-right font-medium text-slate-800">
                  {c.licenseState.replace('_', ' ')}
                </dd>
              </dl>
              <Link
                to={`/companies/${c.id}/employees`}
                className="mt-1 text-sm font-medium text-slate-900 hover:underline"
              >
                Manage →
              </Link>
            </li>
          ))}
        </ul>
        {hasAny && filtered.length === 0 && search && (
          <p className="mt-6 text-sm text-slate-500">No companies match "{search}".</p>
        )}
      </main>
    </>
  );
}
