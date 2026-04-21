import { useQuery } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { licensing } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

/**
 * Per-company license view — read-only. Licensing is managed at the
 * appliance level (a single JWT covers every non-internal company on
 * the box). This page exists only to show the derived state for a
 * company admin + point them at the SuperAdmin settings page for
 * changes.
 */
export function LicensePage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const session = useSession();
  const isSuperAdmin = session?.user.roleGlobal === 'super_admin';

  const status = useQuery({
    queryKey: ['license-status', companyId],
    queryFn: () => licensing.getStatus(companyId),
  });

  if (!status.data) return <p className="text-sm text-slate-500">Loading…</p>;

  const s = status.data;
  const stateClass: Record<typeof s.state, string> = {
    internal_free: 'bg-emerald-100 text-emerald-800',
    licensed: 'bg-emerald-100 text-emerald-800',
    trial: 'bg-amber-100 text-amber-800',
    grace: 'bg-amber-100 text-amber-900',
    expired: 'bg-red-100 text-red-800',
  };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900">License</h1>
        <p className="mt-1 text-sm text-slate-600">
          Licensing is appliance-wide. One license covers every non-internal company on this box;
          internal firm-use companies never need a license.{' '}
          {isSuperAdmin ? (
            <Link to="/appliance/settings" className="text-slate-900 underline">
              Manage at Appliance → Settings
            </Link>
          ) : (
            <span>Ask your appliance SuperAdmin to manage it.</span>
          )}
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Current state</p>
            <p className="mt-1 text-lg">
              <span className={'rounded-full px-3 py-1 text-xs font-medium ' + stateClass[s.state]}>
                {s.state.replace('_', ' ')}
              </span>
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <p>
              Enforcement:{' '}
              <span className="font-medium text-slate-900">
                {s.enforced ? 'ON' : 'off (pre-live)'}
              </span>
            </p>
            {s.expiresAt && (
              <p className="mt-1">
                Expires {new Date(s.expiresAt).toLocaleDateString()}
                {typeof s.daysUntilExpiry === 'number' && (
                  <span className="ml-1 text-slate-500">({s.daysUntilExpiry} days)</span>
                )}
              </p>
            )}
            {s.lastCheckedAt && (
              <p className="mt-1">Last portal check {new Date(s.lastCheckedAt).toLocaleString()}</p>
            )}
          </div>
        </div>

        {s.claims && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
            <p className="mb-2 font-semibold uppercase text-slate-600">Appliance license claims</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-slate-500">Issuer</dt>
              <dd className="text-slate-800">{s.claims.iss}</dd>
              <dt className="text-slate-500">Appliance</dt>
              <dd className="font-mono text-slate-800">{s.claims.appliance_id}</dd>
              <dt className="text-slate-500">Tier</dt>
              <dd className="text-slate-800">{s.claims.tier.replace(/_/g, ' ')}</dd>
              {s.claims.employee_count_cap != null && (
                <>
                  <dt className="text-slate-500">Seat cap</dt>
                  <dd className="text-slate-800">{s.claims.employee_count_cap}</dd>
                </>
              )}
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}
