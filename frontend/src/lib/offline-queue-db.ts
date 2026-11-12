// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * IndexedDB primitives behind the offline punch queue. Kept in their own
 * module so the queue policy (offline-queue.ts) can be unit-tested against
 * an in-memory fake via `vi.mock('../offline-queue-db')`.
 *
 * Stores:
 *   pending_punches   — punches waiting to be sent
 *   rejected_punches  — punches the server refused, kept until the
 *                       employee dismisses the notice
 */

export type StoreName = 'pending_punches' | 'rejected_punches';

const DB_NAME = 'vibept';
// v1: pending_punches. v2: + rejected_punches.
const DB_VERSION = 2;
const STORES: StoreName[] = ['pending_punches', 'rejected_punches'];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab is upgrading: let go so it isn't blocked forever, and
      // reopen on the next call.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    // An older tab holds the v1 connection open. Fail this call (the punch
    // page falls back to an error the employee can see) rather than hang.
    req.onblocked = () => reject(new Error('Close other Vibe PT tabs and try again.'));
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // A failed open must not be cached, or every later call fails too.
  dbPromise = p.catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        let value: T;
        req.onsuccess = () => {
          value = req.result;
        };
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction error'));
      }),
  );
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return run(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export function idbAdd<T extends object>(store: StoreName, value: T): Promise<number> {
  return run(store, 'readwrite', (s) => s.add(value) as IDBRequest<number>);
}

export async function idbDelete(store: StoreName, id: number): Promise<void> {
  await run(store, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}

/** Move one record between stores in a single transaction, so a crash
 *  can't leave a punch in both (re-sent) or neither (lost). */
export function idbMove<T extends object>(
  from: StoreName,
  id: number,
  to: StoreName,
  value: T,
): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([from, to], 'readwrite');
        tx.objectStore(from).delete(id);
        tx.objectStore(to).add(value);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('IDB transaction aborted'));
        tx.onerror = () => reject(tx.error ?? new Error('IDB transaction error'));
      }),
  );
}
