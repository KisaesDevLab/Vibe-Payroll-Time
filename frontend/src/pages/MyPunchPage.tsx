// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentPunchResponse, OpenShift } from '@vibept/shared';
import { KIOSK_LUNCH_PROMPT_SECONDS } from '@vibept/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { usePunchCompany } from '../hooks/usePunchCompany';
import { useSession } from '../hooks/useSession';
import { ApiError, apiFetch } from '../lib/api';
import { enqueuePunch } from '../lib/offline-queue';
import { PunchLocationRequiredError, capturePunchLocation } from '../lib/punch-location';

/**
 * Personal-device punch interface. An employee with a user account hits
 * this page on their phone PWA to clock in/out. Company is selected from
 * their memberships — a user with exactly one company skips the picker.
 *
 * Someone who works for more than one company lands on the company they
 * are clocked in at, else the one they used last (usePunchCompany). One
 * shift at a time: while they are on the clock elsewhere the page says
 * where, and the server refuses a second clock-in (open_shift_elsewhere).
 */
export function MyPunchPage() {
  const session = useSession();
  const qc = useQueryClient();
  // Only memberships where the user actually has an employees row — a
  // supervisor-only or admin-only membership can't clock a shift here,
  // so showing it in the picker produces a guaranteed 403.
  const { memberships, companyId, setCompanyId, company } = usePunchCompany();

  const openShifts = useQuery({
    queryKey: ['my-open-shifts'],
    queryFn: () => apiFetch<OpenShift[]>('/punch/open-shifts'),
    enabled: memberships.length > 1,
    refetchInterval: 30_000,
  });
  // Opening the page while clocked in somewhere: go straight there, once.
  const autoSelected = useRef(false);
  useEffect(() => {
    if (autoSelected.current || !openShifts.data) return;
    autoSelected.current = true;
    const open = openShifts.data.find((s) => memberships.some((m) => m.companyId === s.companyId));
    if (open && open.companyId !== companyId) setCompanyId(open.companyId);
  }, [openShifts.data, memberships, companyId, setCompanyId]);
  const openElsewhere =
    openShifts.data?.find((s) => s.companyId !== companyId && companyId != null) ?? null;

  const current = useQuery({
    queryKey: ['my-current-punch', companyId],
    queryFn: () => apiFetch<CurrentPunchResponse>(`/punch/current?companyId=${companyId}`),
    enabled: companyId != null,
    refetchInterval: 30_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-current-punch', companyId] });
    qc.invalidateQueries({ queryKey: ['my-open-shifts'] });
  };

  const locationMode = current.data?.punchLocationMode ?? 'off';

  /**
   * Try the punch online first. If the network throws (TypeError from
   * fetch, or a 5xx from the server), enqueue for later. Permanent
   * failures (4xx from a reachable server) bubble up as an error the
   * UI shows — queuing a malformed punch would just fail again.
   *
   * When the company records locations, the browser is asked for one
   * fix before the request goes out, and the same fix rides in the
   * queued payload so an offline punch keeps the place it happened.
   * In `required` mode a refused or failed fix throws before anything
   * is sent or queued.
   */
  const post = async (endpoint: string, extra: Record<string, unknown> = {}) => {
    const fields = await capturePunchLocation(locationMode);
    const body = { companyId, ...fields, ...extra };
    try {
      return await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (err) {
      const isTransient =
        !(err instanceof ApiError) ||
        err.code === 'network_error' ||
        (err.status >= 500 && err.status < 600);
      if (isTransient && companyId != null) {
        await enqueuePunch(endpoint, body);
        return { _queued: true };
      }
      throw err;
    }
  };

  const clockIn = useMutation({
    mutationFn: () => post('/punch/clock-in'),
    onSuccess: invalidate,
  });
  const [askLunch, setAskLunch] = useState(false);
  const clockOut = useMutation({
    mutationFn: (lunchMinutes?: 0 | 30 | 60) =>
      post('/punch/clock-out', lunchMinutes === undefined ? {} : { lunchMinutes }),
    onSuccess: () => {
      setAskLunch(false);
      invalidate();
    },
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
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            {company?.companyName ?? 'No company'}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{session.user.email}</p>
        </header>

        {openElsewhere && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">
              You&apos;re {openElsewhere.entryType === 'break' ? 'on break' : 'clocked in'} at{' '}
              {openElsewhere.companyName} since{' '}
              {new Date(openElsewhere.startedAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
              .
            </p>
            <p className="mt-1">Clock out there before starting a shift here.</p>
            <button
              type="button"
              className="mt-2 font-medium underline"
              onClick={() => setCompanyId(openElsewhere.companyId)}
            >
              Go to {openElsewhere.companyName}
            </button>
          </section>
        )}

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
            onClockOut={() => {
              // A long unbroken stretch gets the lunch question first.
              const open = current.data?.openEntry;
              const long =
                current.data?.lunchPromptEnabled !== false &&
                open?.entryType === 'work' &&
                (Date.now() - new Date(open.startedAt).getTime()) / 1000 >=
                  KIOSK_LUNCH_PROMPT_SECONDS;
              if (long) setAskLunch(true);
              else clockOut.mutate(undefined);
            }}
            askLunch={askLunch}
            onLunch={(m) => clockOut.mutate(m)}
            onLunchBack={() => setAskLunch(false)}
            onBreakIn={() => breakIn.mutate()}
            onBreakOut={() => breakOut.mutate()}
          />
        )}

        {companyId != null && current.data && locationMode !== 'off' && (
          <p className="text-xs text-slate-500">
            {locationMode === 'required'
              ? 'This company requires your location with each punch. '
              : 'This company records your location with each punch when you allow it. '}
            Your phone is asked for one fix at the moment you punch and never tracked in between.
          </p>
        )}

        {current.isPending && <p className="text-sm text-slate-500">Loading…</p>}

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err instanceof ApiError || err instanceof PunchLocationRequiredError
              ? err.message
              : 'Punch failed.'}
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
  askLunch,
  onLunch,
  onLunchBack,
}: {
  snapshot: CurrentPunchResponse;
  askLunch: boolean;
  onLunch: (minutes: 0 | 30 | 60) => void;
  onLunchBack: () => void;
  pending: boolean;
  onClockIn: () => void;
  onClockOut: () => void;
  onBreakIn: () => void;
  onBreakOut: () => void;
}) {
  const type = snapshot.openEntry?.entryType;
  const statusLabel = type === 'work' ? 'Working' : type === 'break' ? 'On break' : 'Clocked out';

  const todayHours = (snapshot.todayWorkSeconds / 3600).toFixed(2);

  // The last event, so the person can see when they clocked in / went on
  // break / clocked out without opening the timesheet.
  const lastEvent =
    type === 'work'
      ? `Clocked in at ${eventTime(snapshot.shiftStartedAt ?? snapshot.openEntry!.startedAt)}`
      : type === 'break'
        ? `On break since ${eventTime(snapshot.openEntry!.startedAt)}`
        : snapshot.lastEndedAt
          ? `Clocked out at ${eventTime(snapshot.lastEndedAt)}`
          : null;
  const clockedInAt =
    type === 'break' && snapshot.shiftStartedAt
      ? `Clocked in at ${eventTime(snapshot.shiftStartedAt)}`
      : null;

  return (
    <section className="flex flex-col items-center gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-slate-500">Status</p>
        <p className="mt-1 text-lg font-medium text-slate-800">{statusLabel}</p>
        {lastEvent && <p className="mt-1 text-sm text-slate-700">{lastEvent}</p>}
        {clockedInAt && <p className="text-xs text-slate-500">{clockedInAt}</p>}
        <p className="mt-1 text-xs text-slate-500">Today: {todayHours} hrs worked</p>
      </div>

      {!snapshot.openEntry && (
        <Button className="w-full py-4 text-lg" loading={pending} onClick={onClockIn}>
          Clock in
        </Button>
      )}
      {type === 'work' && askLunch && (
        <>
          <p className="text-center text-lg font-medium text-slate-800">Did you take lunch?</p>
          <p className="text-center text-sm text-slate-600">
            You have been on the clock for over 6 hours. Your time will be adjusted and you will be
            clocked out.
          </p>
          <Button className="w-full py-4 text-lg" loading={pending} onClick={() => onLunch(30)}>
            30 minute lunch
          </Button>
          <Button className="w-full py-4 text-lg" loading={pending} onClick={() => onLunch(60)}>
            60 minute lunch
          </Button>
          <Button
            variant="secondary"
            className="w-full py-3"
            loading={pending}
            onClick={() => onLunch(0)}
          >
            Worked through lunch
          </Button>
          <button type="button" className="text-sm underline" onClick={onLunchBack}>
            Back
          </button>
        </>
      )}
      {type === 'work' && !askLunch && (
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

/** "9:02 AM" today; "Mon 9:02 AM" on another day, so an overnight or
 *  forgotten shift reads unambiguously. Browser-local time. */
function eventTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}
