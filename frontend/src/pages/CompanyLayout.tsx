// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useQuery } from '@tanstack/react-query';
import { Outlet, useParams } from 'react-router-dom';
import { CompanyTabs } from '../components/CompanyTabs';
import { LicenseBanner } from '../components/LicenseBanner';
import { TopBar } from '../components/TopBar';
import { companies as companiesApi } from '../lib/resources';

export function CompanyLayout() {
  const params = useParams();
  const companyId = Number(params.companyId);

  const company = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companiesApi.get(companyId),
    enabled: Number.isFinite(companyId) && companyId > 0,
  });

  if (!Number.isFinite(companyId) || companyId <= 0) {
    return <p className="p-6 text-sm text-red-700">Invalid company id</p>;
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
        <div className="mb-4">
          <LicenseBanner companyId={companyId} />
        </div>
        <Outlet context={{ companyId }} />
      </main>
    </>
  );
}

export interface CompanyContext {
  companyId: number;
}
