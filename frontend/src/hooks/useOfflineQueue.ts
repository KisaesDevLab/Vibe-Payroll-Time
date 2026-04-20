import { useEffect, useState } from 'react';
import { drainQueue, queueSize, subscribeQueueSize } from '../lib/offline-queue';

export function useOfflineQueue(): {
  online: boolean;
  pending: number;
  sync: () => Promise<void>;
} {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState(0);

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
    queueSize().then((n) => {
      if (alive) setPending(n);
    });
    const unsub = subscribeQueueSize((n) => {
      if (alive) setPending(n);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const sync = async () => {
    await drainQueue();
  };

  return { online, pending, sync };
}
