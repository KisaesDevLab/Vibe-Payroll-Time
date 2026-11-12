// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Offline punch queue for the personal-device PWA. Backed by IndexedDB
 * (offline-queue-db.ts) so queued punches survive reloads, tab closes,
 * sign-outs and device restarts.
 *
 * Drained on the main thread — on start, on the `online` event, when the
 * tab becomes visible, on a 60s timer, and on a manual "Sync now". The
 * drain needs the employee's bearer token, which lives in the page, so the
 * service worker does not drain (and iOS has no Background Sync anyway).
 *
 * A queued item records:
 *   - endpoint (relative to the API base) and the JSON payload
 *   - queuedAt — the client time the employee TAPPED, sent at flush time
 *     as `clientStartedAt` together with the current measured skew
 *   - userId / companyId — whose punch it is. Items are only ever sent
 *     under that user's own session; another user's items wait for them.
 *
 * The server owns overlap/conflict decisions. A punch it refuses (4xx
 * other than 401/408/429) moves to the rejected store so the employee is
 * told, instead of vanishing. Punches older than the server's 72-hour
 * offline window are moved there without being sent.
 */

import { ApiError, apiFetch, isTransientError } from './api';
import { authStore } from './auth-store';
import { getClockSkewMs } from './clock-skew';
import { idbAdd, idbDelete, idbGetAll, idbMove } from './offline-queue-db';

const PENDING = 'pending_punches';
const REJECTED = 'rejected_punches';

/** The server refuses offline punches older than this. */
export const MAX_OFFLINE_AGE_MS = 72 * 3600_000;
/** Rejected notices nobody dismissed are pruned after this. */
const REJECTED_RETENTION_MS = 30 * 24 * 3600_000;
const DRAIN_TIMEOUT_MS = 15_000;
const RETRY_INTERVAL_MS = 60_000;

export interface QueuedPunch {
  id?: number;
  endpoint: string; // e.g. '/punch/clock-in'
  payload: Record<string, unknown>;
  /** ISO client time of the tap. */
  queuedAt: string;
  /** Owner. Absent only on items queued by builds before user tagging —
   *  those builds cleared the queue on every sign-out, so an untagged
   *  item belongs to whoever is signed in now. */
  userId?: number;
  companyId?: number;
}

export interface RejectedPunch extends QueuedPunch {
  rejectedAt: string;
  status: number;
  code: string;
  message: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const fn of listeners) fn();
}

/** Fires whenever pending or rejected items change (or the signed-in user
 *  does). Readers re-query with the functions below. */
export function subscribeQueue(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function belongsTo(item: QueuedPunch, userId: number): boolean {
  return item.userId == null || item.userId === userId;
}

const byQueuedAt = (a: QueuedPunch, b: QueuedPunch) =>
  a.queuedAt < b.queuedAt ? -1 : a.queuedAt > b.queuedAt ? 1 : (a.id ?? 0) - (b.id ?? 0);

export async function enqueuePunch(
  endpoint: string,
  payload: Record<string, unknown>,
  meta: { userId: number; companyId?: number | null; tappedAt?: Date },
): Promise<void> {
  const item: QueuedPunch = {
    endpoint,
    payload,
    queuedAt: (meta.tappedAt ?? new Date()).toISOString(),
    userId: meta.userId,
    ...(meta.companyId != null ? { companyId: meta.companyId } : {}),
  };
  await idbAdd(PENDING, item);
  notify();
}

export async function listQueue(): Promise<QueuedPunch[]> {
  return idbGetAll<QueuedPunch>(PENDING);
}

/** The signed-in user's pending punches, oldest first; optionally one company. */
export async function listPendingFor(
  userId: number,
  companyId?: number | null,
): Promise<QueuedPunch[]> {
  const all = await listQueue();
  return all
    .filter((i) => belongsTo(i, userId))
    .filter((i) => companyId == null || i.companyId == null || i.companyId === companyId)
    .sort(byQueuedAt);
}

export async function listRejectedFor(userId: number): Promise<RejectedPunch[]> {
  const all = await idbGetAll<RejectedPunch>(REJECTED);
  return all.filter((i) => belongsTo(i, userId)).sort(byQueuedAt);
}

export async function dismissRejected(id: number): Promise<void> {
  await idbDelete(REJECTED, id);
  notify();
}

async function reject(
  item: QueuedPunch,
  info: { status: number; code: string; message: string },
): Promise<void> {
  const { id, ...rest } = item;
  const rejected: RejectedPunch = { ...rest, ...info, rejectedAt: new Date().toISOString() };
  if (id != null) await idbMove(PENDING, id, REJECTED, rejected);
  else await idbAdd(REJECTED, rejected);
}

export interface DrainResult {
  flushed: number;
  failed: number;
  remaining: number;
}

/**
 * Send the signed-in user's queued punches oldest-first.
 *   - success → removed
 *   - 401, or a transient failure (network, timeout, 5xx, 408, 429) →
 *     stop; everything stays queued for the next attempt
 *   - any other 4xx → moved to the rejected store with the server's message
 *
 * Other users' items are never sent. Items past the 72-hour window (any
 * user's) are moved to rejected without a request.
 *
 * Guarded against concurrent callers: the `online` event, a timer, a
 * manual tap and an auth tick can all land within a few ms, and two
 * drains would each read the pending set and re-POST the same punch.
 */
let drainInFlight: Promise<DrainResult> | null = null;

export function drainQueue(): Promise<DrainResult> {
  if (drainInFlight) return drainInFlight;
  drainInFlight = (async () => {
    let flushed = 0;
    let failed = 0;
    try {
      const userId = authStore.get()?.user.id ?? null;
      const now = Date.now();

      // Housekeeping first — applies to every user's items.
      for (const item of await listQueue()) {
        if (now - Date.parse(item.queuedAt) > MAX_OFFLINE_AGE_MS) {
          await reject(item, {
            status: 0,
            code: 'offline_too_old',
            message:
              'This punch was saved offline more than 72 hours ago and can no longer be sent.',
          });
          if (item.userId == null || item.userId === userId) failed += 1;
        }
      }
      for (const r of await idbGetAll<RejectedPunch>(REJECTED)) {
        if (r.id != null && now - Date.parse(r.rejectedAt) > REJECTED_RETENTION_MS) {
          await idbDelete(REJECTED, r.id);
        }
      }

      if (userId == null) return { flushed, failed, remaining: 0 };

      for (const item of await listPendingFor(userId)) {
        // The session may have changed mid-drain (sign-out, other user).
        if (authStore.get()?.user.id !== userId) break;
        try {
          await apiFetch(item.endpoint, {
            method: 'POST',
            timeoutMs: DRAIN_TIMEOUT_MS,
            body: JSON.stringify({
              ...item.payload,
              clientStartedAt: item.queuedAt,
              clientClockSkewMs: getClockSkewMs(),
            }),
          });
          if (item.id != null) await idbDelete(PENDING, item.id);
          flushed += 1;
        } catch (err) {
          // 401 = the session needs a fresh sign-in; the punch is fine.
          if (!(err instanceof ApiError) || err.status === 401 || isTransientError(err)) break;
          await reject(item, { status: err.status, code: err.code, message: err.message });
          failed += 1;
        }
      }

      const remaining = (await listPendingFor(userId)).length;
      return { flushed, failed, remaining };
    } finally {
      drainInFlight = null;
      notify();
    }
  })();
  return drainInFlight;
}

/**
 * Boot hook. Drains on start, whenever the browser reports it is back
 * online, when the tab becomes visible, on a timer (a timed-out request
 * leaves `navigator.onLine` true, so no `online` event will come), and
 * when a session appears. Never clears the queue: a sign-out or a failed
 * refresh leaves the punches for that user's next sign-in.
 */
export function startQueueFlusher(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const drain = () => {
    if (navigator.onLine && authStore.get()) void drainQueue().catch(() => undefined);
  };
  const onAuth = () => {
    notify(); // the per-user views change with the user
    drain();
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') drain();
  };
  drain();
  const unsub = authStore.subscribe(onAuth);
  window.addEventListener('online', drain);
  document.addEventListener('visibilitychange', onVisible);
  const timer = window.setInterval(drain, RETRY_INTERVAL_MS);
  return () => {
    window.removeEventListener('online', drain);
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
    unsub();
  };
}
