// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CurrentPunchResponse, OpenShift, TimeFormat } from '@vibept/shared';
import { KIOSK_LUNCH_PROMPT_SECONDS, formatHours, isoDateInTz } from '@vibept/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { useCompany } from '../hooks/useCompany';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import { usePunchCompany } from '../hooks/usePunchCompany';
import { useSession } from '../hooks/useSession';
import { ApiError, apiFetch, isTransientError } from '../lib/api';
import { enqueuePunch } from '../lib/offline-queue';
import { PunchLocationRequiredError, capturePunchLocation } from '../lib/punch-location';
import {
  type PunchView,
  applyQueuedPunches,
  loadLastPunchView,
  saveLastPunchView,
  toPunchView,
} from '../lib/punch-state';
import { userPreferences } from '../lib/resources';

/** A punch request that has not answered in this long goes to the offline
 *  queue instead of leaving the employee watching a spinner. */
const PUNCH_TIMEOUT_MS = 10_000;

type PunchEndpoint =
  | '/punch/clock-in'
  | '/punch/clock-out'
  | '/punch/break-in'
  | '/punch/break-out';

/** The server's 403 for "member here, but no employee record". Every other
 *  403 (e.g. sign-in turned off) is shown with the server's own message. */
const NOT_EMPLOYEE_RE = /not an active employee/i;

/**
 * Personal-device punch interface. An employee with a user account hits
 * this page on their phone PWA to clock in/out. Company is selected from
 * their memberships — a user with exactly one company skips the picker.
 *
 * Someone who works for more than one company lands on the company they
 * are clocked in at, else the one they used last (usePunchCompany). One
 * shift at a time: while they are on the clock elsewhere the page says
 * where, and the server refuses a second clock-in (open_shift_elsewhere).
 *
 * Offline: the last status this browser saw is kept per (user, company)
 * and shown when the server can't be reached, with punches still queued
 * on this device folded in — so after a queued Clock in the card reads
 * "Working" and offers Clock out, not a second Clock in.
 */
export function MyPunchPage() {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const qc = useQueryClient();
  // Only memberships where the user actually has an employees row — a
  // supervisor-only or admin-only membership can't clock a shift here,
  // so showing it in the picker produces a guaranteed 403.
  const { memberships, companyId, setCompanyId, company } = usePunchCompany();
  // Company timezone for the clock times on the card (same zone as My
  // timesheet). Unknown offline until fetched once; the browser zone stands in.
  const companyTimezone = useCompany(companyId).data?.timezone;

  const openShifts = useQuery({
    queryKey: ['my-open-shifts'],
    queryFn: () => apiFetch<OpenShift[]>('/punch/open-shifts', { timeoutMs: PUNCH_TIMEOUT_MS }),
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
    queryFn: () =>
      apiFetch<CurrentPunchResponse>(`/punch/current?companyId=${companyId}`, {
        timeoutMs: PUNCH_TIMEOUT_MS,
      }),
    enabled: companyId != null,
    refetchInterval: 30_000,
  });

  const prefsQ = useQuery({
    queryKey: ['me-prefs'],
    queryFn: () => userPreferences.get(),
    enabled: !!session,
  });

  const queue = useOfflineQueue(companyId);
  // Latest queued count, readable from inside the mutation.
  const queuedCountRef = useRef(queue.pending);
  queuedCountRef.current = queue.pending;

  // Last known status for this (user, company), for offline cold starts.
  // Re-read when fresh data lands so a later offline view uses it.
  const cached = useMemo(
    () => (userId != null && companyId != null ? loadLastPunchView(userId, companyId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userId, companyId, current.dataUpdatedAt],
  );
  const timeFormat: TimeFormat =
    prefsQ.data?.timeFormatEffective ?? cached?.timeFormat ?? 'decimal';

  useEffect(() => {
    if (userId == null || companyId == null || !current.data) return;
    saveLastPunchView(
      userId,
      companyId,
      toPunchView(current.data),
      prefsQ.data?.timeFormatEffective,
    );
  }, [userId, companyId, current.data, prefsQ.data?.timeFormatEffective]);

  const baseView: PunchView | null = current.data
    ? toPunchView(current.data)
    : (cached?.view ?? null);
  const view = baseView ? applyQueuedPunches(baseView, queue.pendingItems) : null;
  const unreachable = !queue.online || (current.isError && isTransientError(current.error));
  const showingLastKnown = !!view && (!current.data || unreachable);

  // When queued punches drain, the server's status changes: refetch so
  // the card doesn't fall back to the pre-punch snapshot.
  const prevPending = useRef(queue.pending);
  useEffect(() => {
    if (queue.pending < prevPending.current && companyId != null) {
      void qc.invalidateQueries({ queryKey: ['my-current-punch', companyId] });
      void qc.invalidateQueries({ queryKey: ['my-open-shifts'] });
    }
    prevPending.current = queue.pending;
  }, [queue.pending, companyId, qc]);

  const locationMode = view?.punchLocationMode ?? 'off';

  /**
   * Try the punch online first. If the server can't be reached (offline,
   * timeout, 5xx, 429, or a session that needs a fresh sign-in), queue it
   * on this device with the time of the tap. A refusal from a reachable
   * server (4xx) is shown — queuing it would just fail again.
   *
   * The tap time is taken first, then — only when the company records
   * locations — one GPS fix, before anything goes on the network. The
   * same fix rides in the queued payload so an offline punch keeps the
   * place it happened. In `required` mode a refused or failed fix throws
   * before anything is sent or queued.
   */
  const post = async (
    endpoint: PunchEndpoint,
    extra: Record<string, unknown> = {},
  ): Promise<{ queued: boolean }> => {
    const tappedAt = new Date();
    const fields = await capturePunchLocation(locationMode);
    const body = { companyId, ...fields, ...extra };
    try {
      await apiFetch(endpoint, {
        method: 'POST',
        timeoutMs: PUNCH_TIMEOUT_MS,
        body: JSON.stringify(body),
      });
      return { queued: false };
    } catch (err) {
      const queueable = isTransientError(err) || (err instanceof ApiError && err.status === 401);
      if (!queueable || companyId == null || userId == null) throw err;
      try {
        await enqueuePunch(endpoint, body, { userId, companyId, tappedAt });
      } catch {
        throw new Error(
          'Could not reach the server, and this device could not save the punch. Try again, or use the kiosk.',
        );
      }
      return { queued: true };
    }
  };

  const punch = useMutation({
    // Run even while the browser says it is offline: the request falls
    // through to the queue. The default ('online') would pause the
    // mutation and the punch would never be saved.
    networkMode: 'always',
    mutationFn: async (req: { endpoint: PunchEndpoint; extra?: Record<string, unknown> }) => {
      const queuedBefore = queuedCountRef.current;
      const res = await post(req.endpoint, req.extra);
      if (res.queued) {
        // Stay busy until the card has folded the queued punch in, so the
        // buttons never re-enable showing the pre-punch state.
        const deadline = Date.now() + 2_000;
        while (queuedCountRef.current <= queuedBefore && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
      }
      if (!res.queued) {
        // Keep the buttons disabled until the new status is on screen, so
        // a second tap can't send the same punch twice. Bounded: a server
        // that took the punch but stalls on the read must not lock the page.
        await Promise.race([
          Promise.all([
            qc.refetchQueries({ queryKey: ['my-current-punch', companyId] }),
            qc.invalidateQueries({ queryKey: ['my-open-shifts'] }),
          ]),
          new Promise((r) => setTimeout(r, PUNCH_TIMEOUT_MS)),
        ]);
      }
      return res;
    },
  });

  const inFlight = useRef(false);
  const [askLunch, setAskLunch] = useState(false);
  const openKey = view?.openEntry ? `${view.openEntry.id ?? 'q'}:${view.openEntry.startedAt}` : '';
  // A different open entry or company makes a pending lunch question stale.
  useEffect(() => {
    setAskLunch(false);
  }, [openKey, companyId]);
  // An error (or "saved offline" note) from one company must not show on another.
  const resetPunch = punch.reset;
  useEffect(() => {
    resetPunch();
  }, [companyId, resetPunch]);

  if (!session) return null;

  const run = (endpoint: PunchEndpoint, extra?: Record<string, unknown>) => {
    // A ref, not punch.isPending: two taps in the same frame both see the
    // pre-render isPending=false.
    if (inFlight.current) return;
    inFlight.current = true;
    punch.mutate(
      { endpoint, extra },
      {
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };

  const pending = punch.isPending;
  const err = punch.error as Error | null;
  const queuedNote = !pending && !err && punch.data?.queued;

  const currentErr = current.error instanceof ApiError ? current.error : null;
  const forbidden = currentErr?.status === 403 ? currentErr : null;

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

        {companyId != null && forbidden && NOT_EMPLOYEE_RE.test(forbidden.message) && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Not an employee at this company.</p>
            <p className="mt-1">
              You're a member (admin / supervisor) but don't have an active employee record here, so
              there's nothing to clock into. If you also need to track your own hours, ask an admin
              to create an employee record for you at this company.
            </p>
          </section>
        )}

        {companyId != null && forbidden && !NOT_EMPLOYEE_RE.test(forbidden.message) && (
          <section className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">{forbidden.message}</p>
          </section>
        )}

        {companyId != null && current.error && !forbidden && !isTransientError(current.error) && (
          <section className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {current.error instanceof Error ? current.error.message : 'Could not load punch state.'}
          </section>
        )}

        {memberships.length > 1 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Company</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={companyId ?? ''}
              disabled={punch.isPending}
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

        {companyId != null && view && !forbidden && showingLastKnown && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {queue.online ? "Can't reach the server." : "You're offline."} Showing your last known
            status{cached ? ` from ${eventTime(cached.savedAt)}` : ''}
            {queue.pending > 0 ? ', including punches saved on this device' : ''}. Punches you make
            now are saved here and sent when the connection is back.
          </p>
        )}

        {companyId != null && !view && !forbidden && unreachable && (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {queue.online ? "Can't reach the server" : "You're offline"} and this device hasn't
            loaded your status yet. Connect once so this phone can punch offline, or use the kiosk.
          </p>
        )}

        {companyId != null && view && !forbidden && (
          <PunchCard
            snapshot={view}
            timeFormat={timeFormat}
            timezone={companyTimezone}
            pending={pending}
            onClockIn={() => run('/punch/clock-in')}
            onClockOut={() => {
              // A long unbroken stretch gets the lunch question first.
              const open = view.openEntry;
              const long =
                view.lunchPromptEnabled &&
                open?.entryType === 'work' &&
                (Date.now() - new Date(open.startedAt).getTime()) / 1000 >=
                  KIOSK_LUNCH_PROMPT_SECONDS;
              if (long) setAskLunch(true);
              else run('/punch/clock-out');
            }}
            askLunch={askLunch}
            onLunch={(m) => run('/punch/clock-out', { lunchMinutes: m })}
            onLunchBack={() => setAskLunch(false)}
            onBreakIn={() => run('/punch/break-in')}
            onBreakOut={() => run('/punch/break-out')}
          />
        )}

        {companyId != null && view && !forbidden && locationMode !== 'off' && (
          <p className="text-xs text-slate-500">
            {locationMode === 'required'
              ? 'This company requires your location with each punch. '
              : 'This company records your location with each punch when you allow it. '}
            Your phone is asked for one fix at the moment you punch and never tracked in between.
          </p>
        )}

        {current.isPending && !view && !unreachable && (
          <p className="text-sm text-slate-500">Loading…</p>
        )}

        {queuedNote && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Saved on this device. It will be sent automatically when the connection is back.
          </div>
        )}

        {err && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {err instanceof ApiError || err instanceof PunchLocationRequiredError || err.message
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
  timeFormat,
  timezone,
  pending,
  onClockIn,
  onClockOut,
  onBreakIn,
  onBreakOut,
  askLunch,
  onLunch,
  onLunchBack,
}: {
  snapshot: PunchView;
  timeFormat: TimeFormat;
  /** Company timezone, matching My timesheet; browser zone until known. */
  timezone: string | undefined;
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

  const todayHours = formatHours(snapshot.todayWorkSeconds, timeFormat);
  const unit = timeFormat === 'hhmm' ? '' : ' hrs';

  // The last event, so the person can see when they clocked in / went on
  // break / clocked out without opening the timesheet.
  const lastEvent =
    type === 'work'
      ? `Clocked in at ${eventTime(snapshot.shiftStartedAt ?? snapshot.openEntry!.startedAt, timezone)}`
      : type === 'break'
        ? `On break since ${eventTime(snapshot.openEntry!.startedAt, timezone)}`
        : snapshot.lastEndedAt
          ? `Clocked out at ${eventTime(snapshot.lastEndedAt, timezone)}`
          : null;
  const clockedInAt =
    type === 'break' && snapshot.shiftStartedAt
      ? `Clocked in at ${eventTime(snapshot.shiftStartedAt, timezone)}`
      : null;

  return (
    <section className="flex flex-col items-center gap-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-slate-500">Status</p>
        <p className="mt-1 text-lg font-medium text-slate-800">{statusLabel}</p>
        {lastEvent && <p className="mt-1 text-sm text-slate-700">{lastEvent}</p>}
        {clockedInAt && <p className="text-xs text-slate-500">{clockedInAt}</p>}
        <p className="mt-1 text-xs text-slate-500">
          Today: {todayHours}
          {unit} worked
        </p>
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
 *  forgotten shift reads unambiguously. In the company's timezone when
 *  known (as on My timesheet), otherwise the browser's. */
function eventTime(iso: string, timezone?: string): string {
  const d = new Date(iso);
  const zone = timezone ? { timeZone: timezone } : {};
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...zone });
  const sameDay = timezone
    ? isoDateInTz(d, timezone) === isoDateInTz(new Date(), timezone)
    : d.toDateString() === new Date().toDateString();
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...zone })} ${time}`;
}
