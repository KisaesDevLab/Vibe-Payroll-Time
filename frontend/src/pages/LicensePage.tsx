import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { ApiError } from '../lib/api';
import { licensing } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

/**
 * License management for CompanyAdmins — paste a JWT, see parsed
 * claims, clear if needed. The appliance-wide enforcement flag is
 * surfaced so an admin can tell whether the server is currently
 * gating based on what they upload.
 */
export function LicensePage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();
  const [jwtText, setJwtText] = useState('');

  const status = useQuery({
    queryKey: ['license-status', companyId],
    queryFn: () => licensing.getStatus(companyId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['license-status', companyId] });

  const upload = useMutation({
    mutationFn: () => licensing.upload(companyId, jwtText.trim()),
    onSuccess: () => {
      setJwtText('');
      invalidate();
    },
  });

  const clear = useMutation({
    mutationFn: () => licensing.clear(companyId),
    onSuccess: invalidate,
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
          License keys are vended by the{' '}
          <a
            href="https://licensing.kisaes.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            kisaes-license-portal
          </a>
          . Paste the JWT below to activate. Internal firm-use companies don't need a license.
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
            <p className="mb-2 font-semibold uppercase text-slate-600">Claims</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-slate-500">Issuer</dt>
              <dd className="text-slate-800">{s.claims.iss}</dd>
              <dt className="text-slate-500">Appliance</dt>
              <dd className="font-mono text-slate-800">{s.claims.appliance_id}</dd>
              <dt className="text-slate-500">Company slug</dt>
              <dd className="font-mono text-slate-800">{s.claims.company_slug}</dd>
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

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Upload a license JWT</h2>
        <p className="mt-1 text-xs text-slate-500">
          Paste the full token from the portal, including the two dots. The server verifies the
          RS256 signature before saving.
        </p>
        <textarea
          className="mt-3 h-40 w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-xs shadow-sm"
          placeholder="eyJ..."
          value={jwtText}
          onChange={(e) => setJwtText(e.target.value)}
        />
        {upload.isError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {upload.error instanceof ApiError
              ? `${upload.error.code}: ${upload.error.message}`
              : 'Upload failed.'}
          </div>
        )}
        <div className="mt-3 flex justify-between gap-2">
          {(s.state === 'licensed' || s.state === 'expired' || s.state === 'grace') && (
            <Button
              variant="secondary"
              onClick={() => {
                if (confirm('Clear the stored license and revert to trial?')) clear.mutate();
              }}
              loading={clear.isPending}
            >
              Clear license
            </Button>
          )}
          <div className="ml-auto">
            <Button
              disabled={!jwtText.trim()}
              loading={upload.isPending}
              onClick={() => upload.mutate()}
            >
              Upload license
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
