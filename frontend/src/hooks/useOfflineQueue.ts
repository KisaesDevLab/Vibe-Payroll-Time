// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useState } from 'react';
import {
  dismissRejected,
  drainQueue,
  listPendingFor,
  listRejectedFor,
  subscribeQueue,
  type QueuedPunch,
  type RejectedPunch,
} from '../lib/offline-queue';
import { useSession } from './useSession';

/**
 * The signed-in user's slice of the offline punch queue: pending punches
 * (optionally for one company), punches the server rejected, and the
 * browser's online flag. Re-reads whenever the queue changes.
 */
export function useOfflineQueue(companyId?: number | null): {
  online: boolean;
  pending: number;
  pendingItems: QueuedPunch[];
  rejected: RejectedPunch[];
  /** False until the first read from IndexedDB completes. */
  loaded: boolean;
  sync: () => Promise<void>;
  dismiss: (id: number) => Promise<void>;
} {
  const session = useSession();
  const userId = session?.user.id ?? null;
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pendingItems, setPendingItems] = useState<QueuedPunch[]>([]);
  const [rejected, setRejected] = useState<RejectedPunch[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (userId == null) {
      setPendingItems([]);
      setRejected([]);
      setLoaded(true);
      return;
    }
    const load = () => {
      Promise.all([listPendingFor(userId, companyId), listRejectedFor(userId)])
        .then(([p, r]) => {
          if (!alive) return;
          setPendingItems(p);
          setRejected(r);
          setLoaded(true);
        })
        .catch(() => {
          // IndexedDB unavailable (private mode on some browsers): show nothing queued.
          if (alive) setLoaded(true);
        });
    };
    load();
    const unsub = subscribeQueue(load);
    return () => {
      alive = false;
      unsub();
    };
  }, [userId, companyId]);

  const sync = useCallback(async () => {
    await drainQueue().catch(() => undefined);
  }, []);
  const dismiss = useCallback(async (id: number) => {
    await dismissRejected(id).catch(() => undefined);
  }, []);

  return {
    online,
    pending: pendingItems.length,
    pendingItems,
    rejected,
    loaded,
    sync,
    dismiss,
  };
}
