import { useOfflineQueue } from '../hooks/useOfflineQueue';

/**
 * Small corner banner visible whenever we're offline or have queued
 * punches. Appears on every screen via App-level mount. Non-intrusive;
 * doesn't block any interaction.
 */
export function OfflineBanner() {
  const { online, pending, sync } = useOfflineQueue();

  if (online && pending === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-lg">
      <span
        className={'h-2 w-2 rounded-full ' + (online ? 'bg-amber-500' : 'bg-red-500 animate-pulse')}
      />
      {!online && <span className="font-medium text-slate-700">Offline</span>}
      {pending > 0 && (
        <span className="text-slate-600">
          {pending} punch{pending === 1 ? '' : 'es'} queued
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
  );
}
