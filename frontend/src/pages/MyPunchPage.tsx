import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentPunchResponse } from '@vibept/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { ApiError, apiFetch } from '../lib/api';
import { enqueuePunch } from '../lib/offline-queue';

/**
 * Personal-device punch interface. An employee with a user account hits
 * this page on their phone PWA to clock in/out. Company is selected from
 * their memberships — a user with exactly one company skips the picker.
 */
export function MyPunchPage() {
  const session = useSession();
  const qc = useQueryClient();
  // Only memberships where the user actually has an employees row — a
  // supervisor-only or admin-only membership can't clock a shift here,
  // so showing it in the picker produces a guaranteed 403.
  const memberships = useMemo(
    () => session?.user.memberships.filter((m) => m.isEmployee) ?? [],
    [session],
  );

  const [companyId, setCompanyId] = useState<number | null>(memberships[0]?.companyId ?? null);
  useEffect(() => {
    if (!companyId && memberships[0]) setCompanyId(memberships[0].companyId);
  }, [memberships, companyId]);

  const current = useQuery({
    queryKey: ['my-current-punch', companyId],
    queryFn: () => apiFetch<CurrentPunchResponse>(`/punch/current?companyId=${companyId}`),
    enabled: companyId != null,
    refetchInterval: 30_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['my-current-punch', companyId] });

  /**
   * Try the punch online first. If the network throws (TypeError from
   * fetch, or a 5xx from the server), enqueue for later. Permanent
   * failures (4xx from a reachable server) bubble up as an error the
   * UI shows — queuing a malformed punch would just fail again.
   */
  const post = async (endpoint: string) => {
    try {
      return await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ companyId }),
      });
    } catch (err) {
      const isTransient =
        !(err instanceof ApiError) ||
        err.code === 'network_error' ||
        (err.status >= 500 && err.status < 600);
      if (isTransient && companyId != null) {
        await enqueuePunch(endpoint, { companyId });
        return { _queued: true };
      }
      throw err;
    }
  };

  const clockIn = useMutation({
    mutationFn: () => post('/punch/clock-in'),
    onSuccess: invalidate,
  });
  const clockOut = useMutation({
    mutationFn: () => post('/punch/clock-out'),
    onSuccess: invalidate,
  });
  const breakIn = useMutation({
    mutationFn: () => post('/punch/break-in'),
    onSuccess: invalidate,
  });
  const breakOut = useMutation({
    mutationFn: () => post('/punch/break-out'),
    onSuccess: invalidate,
  });

  if (!session) return null;

  const pending =
    clockIn.isPending || clockOut.isPending || breakIn.isPending || breakOut.isPending;
  const err = (clockIn.error ?? clockOut.error ?? breakIn.error ?? breakOut.error) as Error | null;

  return (
    <>
      <TopBar />
      <main className="mx-auto flex max-w-md flex-col gap-8 px-6 py-10">
        <header>
          <p className="text-xs uppercase tracking-widest text-slate-500">My time</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{session.user.email}</h1>
        </header>

        {memberships.length === 0 && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            You don't have an active employee record at any company on this appliance. Admins and
            supervisors don't clock a shift unless they also have an employee record — ask another
            admin to create one for you if you need to track your own hours.
          </section>
        )}

        {companyId != null && current.error instanceof ApiError && current.error.status === 403 && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Not an employee at this company.</p>
            <p className="mt-1">
              You're a member (admin / supervisor) but don't have an active employee record here, so
              there's nothing to clock into. If you also need to track your own hours, ask an admin
              to create an employee record for you at this company.
            </p>
          </section>
        )}

        {companyId != null &&
          current.error &&
          !(current.error instanceof ApiError && current.error.status === 403) && (
            <section className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {current.error instanceof Error
                ? current.error.message
                : 'Could not load punch state.'}
            </section>
          )}

        {memberships.length > 1 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Company</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={companyId ?? ''}
              onChange={(e) => setCompanyId(Number(e.target.value))}
            >
              {memberships.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.companyName}
                </option>
              ))}
            </select>
          </label>
        )}

        {companyId != null && current.data && (
          <PunchCard
            snapshot={current.data}
            pending={pending}
            onClockIn={() => clockIn.mutate()}
            onClockOut={() => clockOut.mutate()}
            onBreakIn={() => breakIn.mutate()}
            onBreakOut={() => breakOut.mutate()}
          />
        )}

        {current.isPending && <p className="text-sm text-slate-500">Loading…</p>}

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err instanceof ApiError ? err.message : 'Punch failed.'}
          </div>
        )}
      </main>
    </>
  );
}

function PunchCard({
  snapshot,
  pending,
  onClockIn,
  onClockOut,
  onBreakIn,
  onBreakOut,
}: {
  snapshot: CurrentPunchResponse;
  pending: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  onBreakIn: () => void;
  onBreakOut: () => void;
}) {
  const type = snapshot.openEntry?.entryType;
  const statusLabel = type === 'work' ? 'Working' : type === 'break' ? 'On break' : 'Clocked out';

  const todayHours = (snapshot.todayWorkSeconds / 3600).toFixed(2);

  return (
    <section className="flex flex-col items-center gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-slate-500">Status</p>
        <p className="mt-1 text-lg font-medium text-slate-800">{statusLabel}</p>
        <p className="mt-1 text-xs text-slate-500">Today: {todayHours} hrs worked</p>
      </div>

      {!snapshot.openEntry && (
        <Button className="w-full py-4 text-lg" loading={pending} onClick={onClockIn}>
          Clock in
        </Button>
      )}
      {type === 'work' && (
        <>
          <Button className="w-full py-4 text-lg" loading={pending} onClick={onClockOut}>
            Clock out
          </Button>
          <Button variant="secondary" className="w-full py-3" loading={pending} onClick={onBreakIn}>
            Start break
          </Button>
        </>
      )}
      {type === 'break' && (
        <Button className="w-full py-4 text-lg" loading={pending} onClick={onBreakOut}>
          End break
        </Button>
      )}
    </section>
  );
}
