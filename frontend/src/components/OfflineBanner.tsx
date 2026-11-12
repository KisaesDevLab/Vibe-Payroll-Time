// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useLocation } from 'react-router-dom';
import { useOfflineQueue } from '../hooks/useOfflineQueue';
import type { RejectedPunch } from '../lib/offline-queue';

const PUNCH_LABELS: Record<string, string> = {
  '/punch/clock-in': 'Clock in',
  '/punch/clock-out': 'Clock out',
  '/punch/break-in': 'Start break',
  '/punch/break-out': 'End break',
  '/punch/switch-job': 'Job switch',
};

function punchLabel(endpoint: string): string {
  return PUNCH_LABELS[endpoint] ?? 'Punch';
}

function when(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Corner banner, visible whenever we're offline, have queued punches, or
 * a queued punch was refused by the server. Mounted app-wide; hidden on
 * the kiosk, which has no user session and no queue.
 */
export function OfflineBanner() {
  const location = useLocation();
  const { online, pending, rejected, sync, dismiss } = useOfflineQueue();

  if (location.pathname.startsWith('/kiosk')) return null;
  if (online && pending === 0 && rejected.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {rejected.map((r) => (
        <RejectedNotice key={r.id} item={r} onDismiss={() => r.id != null && void dismiss(r.id)} />
      ))}
      {(!online || pending > 0) && (
        <div className="flex items-center gap-3 self-end rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg">
          <span
            className={
              'h-2 w-2 rounded-full ' + (online ? 'bg-amber-500' : 'animate-pulse bg-red-500')
            }
          />
          {!online && <span className="font-medium text-slate-700">Offline</span>}
          {pending > 0 && (
            <span className="text-slate-600">
              {pending} punch{pending === 1 ? '' : 'es'} saved, waiting to send
            </span>
          )}
          {online && pending > 0 && (
            <button
              type="button"
              onClick={() => void sync()}
              className="text-sm font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-700"
            >
              Sync now
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RejectedNotice({ item, onDismiss }: { item: RejectedPunch; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-lg"
    >
      <p className="font-medium">
        {punchLabel(item.endpoint)} from {when(item.queuedAt)} was refused by the server.
      </p>
      <p className="mt-1">{item.message}</p>
      <p className="mt-1">
        Check your timesheet. If the time is missing, ask your supervisor to fix it or use Add time.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 font-medium underline decoration-red-300 hover:decoration-red-700"
      >
        Dismiss
      </button>
    </div>
  );
}
