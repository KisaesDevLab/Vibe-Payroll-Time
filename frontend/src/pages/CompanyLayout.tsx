// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { CompanyTabs, canManageCompany } from '../components/CompanyTabs';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { companies as companiesApi } from '../lib/resources';

export function CompanyLayout() {
  const params = useParams();
  const companyId = Number(params.companyId);
  const session = useSession();
  const validId = Number.isFinite(companyId) && companyId > 0;
  const allowed = !!session && validId && canManageCompany(session.user, companyId);

  const company = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companiesApi.get(companyId),
    enabled: allowed,
  });

  if (!validId) {
    return <p className="p-6 text-sm text-red-700">Invalid company id</p>;
  }
  // Every page under /companies/:id is an admin or supervisor page. An
  // employee there (an old bookmark, a link from the dashboard, a typed
  // URL) gets their own timesheet instead of a row of 403s; anyone else
  // without a role at this company goes home.
  if (session && !allowed) {
    const membership = session.user.memberships.find((m) => m.companyId === companyId);
    return <Navigate to={membership?.role === 'employee' ? '/my-timesheet' : '/'} replace />;
  }

  return (
    <>
      <TopBar />
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <h1 className="text-xl font-semibold text-slate-900">
            {company.data?.name ?? <span className="text-slate-400">loading…</span>}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            {company.data?.slug} · {company.data?.timezone} ·{' '}
            {company.data?.payPeriodType.replace('_', '-')}
          </p>
        </div>
        <CompanyTabs companyId={companyId} />
      </div>
      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Company pages load on demand (App.tsx lazyPage); keep the
            header and tabs on screen while one loads. */}
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <Outlet context={{ companyId }} />
        </Suspense>
      </main>
    </>
  );
}

export interface CompanyContext {
  companyId: number;
}
