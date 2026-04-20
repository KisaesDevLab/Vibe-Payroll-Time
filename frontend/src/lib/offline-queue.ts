/**
 * Offline punch queue. Backed by IndexedDB so queued punches survive page
 * reloads, tab closes, and even device restarts. Phase 5 scope:
 *   - Main-thread queue drained on reconnection or manual "Sync now".
 *   - Service worker Background Sync is a future enhancement; iOS doesn't
 *     support the API, so the main-thread path is the baseline anyway.
 *
 * A queued item records:
 *   - endpoint (relative to the API base)
 *   - JSON payload WITHOUT clientStartedAt/clientClockSkewMs; those are
 *     injected at flush time from the queuedAt timestamp + the current
 *     measured skew.
 *   - queuedAt (client ISO) — what we reconstruct client_started_at from.
 *
 * The server owns offline-age rejection (> 72 hours) and overlap
 * conflict resolution. The queue just retries until the server
 * acknowledges or explicitly rejects.
 */

import { apiFetch, ApiError } from './api';
import { getClockSkewMs } from './clock-skew';
import { authStore } from './auth-store';

const DB_NAME = 'vibept';
const DB_VERSION = 1;
const STORE = 'pending_punches';

export interface QueuedPunch {
  id?: number;
  endpoint: string; // e.g. '/punch/clock-in'
  payload: Record<string, unknown>;
  queuedAt: string; // ISO client time
}

type Listener = (size: number) => void;
const listeners = new Set<Listener>();

function emit(size: number) {
  for (const fn of listeners) fn(size);
}

export function subscribeQueueSize(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let value: T;
    const rOrP = fn(store);
    if (rOrP instanceof IDBRequest) {
      rOrP.onsuccess = () => {
        value = rOrP.result;
      };
      rOrP.onerror = () => reject(rOrP.error ?? new Error('IDB op failed'));
    } else {
      rOrP.then((v) => {
        value = v;
      }, reject);
    }
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IDB transaction error'));
  });
}

export async function enqueuePunch(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await withStore('readwrite', (store) => {
    const req = store.add({
      endpoint,
      payload,
      queuedAt: new Date().toISOString(),
    } satisfies QueuedPunch);
    return req as IDBRequest<number>;
  });
  emit(await queueSize());
}

export async function listQueue(): Promise<QueuedPunch[]> {
  return withStore('readonly', (store) => store.getAll() as IDBRequest<QueuedPunch[]>);
}

export async function queueSize(): Promise<number> {
  return withStore('readonly', (store) => store.count() as IDBRequest<number>);
}

async function removeFromQueue(id: number): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id) as IDBRequest<undefined>);
}

export async function clearQueue(): Promise<void> {
  await withStore('readwrite', (store) => store.clear() as IDBRequest<undefined>);
  emit(0);
}

/**
 * Try to flush the queue. Sends items oldest-first; stops on the first
 * transient failure (so we don't burn attempts against a down server).
 * Permanent failures (4xx from the server) drop the item and continue —
 * the audit log on the server captures the reason.
 *
 * Returns { flushed, failed, remaining }.
 */
export async function drainQueue(): Promise<{
  flushed: number;
  failed: number;
  remaining: number;
}> {
  const items = await listQueue();
  items.sort((a, b) => (a.queuedAt < b.queuedAt ? -1 : 1));

  let flushed = 0;
  let failed = 0;

  for (const item of items) {
    const skew = getClockSkewMs();
    const body = {
      ...item.payload,
      clientStartedAt: item.queuedAt,
      clientClockSkewMs: skew,
    };

    try {
      await apiFetch(item.endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (item.id) await removeFromQueue(item.id);
      flushed += 1;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Permanent error (stale, conflict, validation). Drop it.
        if (item.id) await removeFromQueue(item.id);
        failed += 1;
        continue;
      }
      // Transient — stop; we'll retry on next `online` or manual tap.
      break;
    }
  }

  const remaining = await queueSize();
  emit(remaining);
  return { flushed, failed, remaining };
}

/**
 * Boot hook: drain on start + whenever the browser reports we came back
 * online. Also re-drain when we regain a user session so a fresh login
 * can clear anything queued against the old (possibly expired) token.
 */
export function startQueueFlusher(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const tick = () => {
    if (navigator.onLine && authStore.get()) void drainQueue();
  };
  tick();
  const unsub = authStore.subscribe(tick);
  window.addEventListener('online', tick);
  return () => {
    window.removeEventListener('online', tick);
    unsub();
  };
}
