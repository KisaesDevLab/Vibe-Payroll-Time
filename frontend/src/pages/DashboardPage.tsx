import { useQuery } from '@tanstack/react-query';
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

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {companies.data?.map((c) => (
            <li
              key={c.id}
              className="group flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{c.name}</h2>
                  <p className="mt-0.5 text-xs text-slate-500">{c.slug}</p>
                </div>
                {c.isInternal && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    Internal
                  </span>
                )}
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
      </main>
    </>
  );
}
