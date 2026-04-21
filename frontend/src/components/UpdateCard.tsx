import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { LatestRelease, UpdateCheckResponse } from '@vibept/shared';
import { admin } from '../lib/resources';
import { ApiError } from '../lib/api';

/**
 * Self-service update card for the Appliance dashboard.
 *
 * UX flow:
 *   idle → [Check for updates] → checking → { up-to-date | available }
 *   available → [Update Now] → confirm modal → running → reconnecting → reloaded
 *
 * The backend is recreated mid-update, so this component tolerates the
 * API disappearing for 30-120s and auto-reloads when it comes back.
 */
export function UpdateCard() {
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: ['admin-update-status'],
    queryFn: admin.updateStatus,
    // Poll every 2s while an update is in progress; otherwise don't poll
    // at all — the check is explicit, driven by the button.
    refetchInterval: (q) => (q.state.data?.inProgress ? 2000 : false),
    retry: false,
  });

  const inProgress = status.data?.inProgress ?? false;
  const running = status.data?.running;

  const [latest, setLatest] = useState<LatestRelease | null>(null);
  const [checkState, setCheckState] = useState<'idle' | 'checked'>('idle');
  const [checkError, setCheckError] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const check = useMutation({
    mutationFn: admin.updateCheck,
    onSuccess: (res: UpdateCheckResponse) => {
      setLatest(res.latest);
      setCheckError(res.reachable ? null : (res.error ?? 'GitHub unreachable'));
      setCheckState('checked');
    },
    onError: (err) => {
      setLatest(null);
      setCheckError(err instanceof Error ? err.message : 'unknown error');
      setCheckState('checked');
    },
  });

  const run = useMutation({
    mutationFn: admin.updateRun,
    onSuccess: () => {
      setConfirmOpen(false);
      // Give systemd a beat to pick up the request file, then refetch.
      setTimeout(() => qc.invalidateQueries({ queryKey: ['admin-update-status'] }), 500);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'conflict') {
        // Another update is in progress — still refresh so UI shows it.
        qc.invalidateQueries({ queryKey: ['admin-update-status'] });
      }
    },
  });

  const updateAvailable = Boolean(
    latest?.tagName && running?.version && !versionsMatch(running.version, latest.tagName),
  );

  if (status.isLoading) {
    return (
      <Shell>
        <p className="text-sm text-slate-500">Loading updater…</p>
      </Shell>
    );
  }

  if (inProgress) {
    return (
      <Shell title="Updating…">
        <UpdateProgress />
      </Shell>
    );
  }

  return (
    <Shell title="Updates">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Running</p>
            <p className="mt-1 font-mono text-slate-900">{running?.version ?? 'unknown'}</p>
            {running?.gitSha && running.gitSha !== 'unknown' && (
              <p className="text-xs text-slate-500">git {running.gitSha.slice(0, 7)}</p>
            )}
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500">Latest on GitHub</p>
            {checkState === 'idle' ? (
              <p className="mt-1 text-sm text-slate-500">
                Click "Check" to look for a newer release.
              </p>
            ) : checkError ? (
              <p className="mt-1 text-sm text-amber-700">Couldn't reach GitHub: {checkError}</p>
            ) : latest ? (
              <>
                <p className="mt-1 font-mono text-slate-900">{latest.tagName}</p>
                <p className="text-xs text-slate-500">
                  {latest.publishedAt
                    ? new Date(latest.publishedAt).toLocaleDateString()
                    : 'unknown date'}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-slate-500">No releases published yet.</p>
            )}
          </div>
        </div>

        {status.data?.lastRun && status.data.lastRun.state === 'finished' && (
          <LastRunBanner last={status.data.lastRun} />
        )}

        {checkState === 'checked' && latest && updateAvailable && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
            <p className="font-medium text-emerald-900">
              Update available: {latest.tagName}
              {latest.name && latest.name !== latest.tagName ? ` — ${latest.name}` : ''}
            </p>
            {latest.body && (
              <button
                type="button"
                className="mt-1 text-xs text-emerald-800 underline"
                onClick={() => setShowNotes((s) => !s)}
              >
                {showNotes ? 'Hide' : 'Show'} release notes
              </button>
            )}
            {showNotes && latest.body && (
              <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-mono text-xs text-slate-800">
                {latest.body}
              </pre>
            )}
          </div>
        )}

        {checkState === 'checked' && latest && !updateAvailable && !checkError && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            You're on the latest version.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => check.mutate()}
            disabled={check.isPending}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {check.isPending ? 'Checking…' : 'Check for updates'}
          </button>

          {updateAvailable && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={run.isPending}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
            >
              Update now
            </button>
          )}

          {run.isError && (
            <p className="text-sm text-red-700">
              {run.error instanceof Error ? run.error.message : 'failed to queue update'}
            </p>
          )}
        </div>

        <p className="text-xs text-slate-500">
          Updates run <code>scripts/appliance/update.sh</code> on the host. A full pg_dump is taken
          first, and the appliance rolls back automatically if the new version fails its health
          check (so long as no migrations ran).
        </p>
      </div>

      {confirmOpen && latest && (
        <ConfirmModal
          latest={latest}
          running={running?.version ?? 'unknown'}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => run.mutate()}
          pending={run.isPending}
        />
      )}
    </Shell>
  );
}

function versionsMatch(running: string, latest: string): boolean {
  // Match on the core version — latest is always a tag like "v1.2.0",
  // running may be "v1.2.0", "v1.2.0-3-gabc1234", or a bare SHA.
  if (running === latest) return true;
  return running.startsWith(`${latest}-`);
}

function Shell({ title = 'Updates', children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function LastRunBanner({
  last,
}: {
  last: NonNullable<Awaited<ReturnType<typeof admin.updateStatus>>['lastRun']>;
}) {
  if (last.outcome === 'success') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
        Last update succeeded{last.post_sha ? ` (${last.post_sha.slice(0, 7)})` : ''} at{' '}
        {last.updated_at ? new Date(last.updated_at).toLocaleString() : 'unknown'}.
      </div>
    );
  }
  if (last.outcome === 'failed') {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-900">
        Last update failed: {last.message || 'see log'}. Appliance is running{' '}
        {last.post_sha ? `git ${last.post_sha.slice(0, 7)}` : 'the previous version'}.
      </div>
    );
  }
  return null;
}

function ConfirmModal({
  latest,
  running,
  onCancel,
  onConfirm,
  pending,
}: {
  latest: LatestRelease;
  running: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
        <h3 className="text-base font-semibold text-slate-900">
          Update {running} → {latest.tagName}?
        </h3>
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          <li>
            • A full database backup (<code>pg_dump</code>) runs before anything changes.
          </li>
          <li>• Git pulls the release, images rebuild, containers recreate.</li>
          <li>• The backend is offline for about 30–120 seconds.</li>
          <li>
            • If the new version fails its health check, the appliance rolls back automatically (if
            no migrations ran).
          </li>
          <li>
            • Your <code>.env</code> and company data are not touched.
          </li>
        </ul>
        <p className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-900">
          This page will briefly go blank while the frontend container restarts — that's normal. It
          will reconnect and reload automatically.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? 'Queuing…' : 'Yes, update now'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Live log tail + graceful handling of mid-update backend restart.
 *
 * Polls /admin/update/log?since=<offset> every 1.5s. When the backend
 * temporarily disappears (its container is being recreated), fetch errors
 * are swallowed and we keep polling — the next successful response picks
 * up where we left off. When the poll reports `complete: true` AND the
 * status endpoint confirms inProgress is false, we reload the page to
 * pick up the new bundle.
 */
function UpdateProgress() {
  const [log, setLog] = useState('');
  const [offset, setOffset] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);
  const reloadTriggered = useRef(false);
  const logBoxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      try {
        const chunk = await admin.updateLog(offset);
        setReconnecting(false);
        if (chunk.content) {
          setLog((prev) => prev + chunk.content);
          setOffset(chunk.nextOffset);
        } else if (chunk.nextOffset !== offset) {
          setOffset(chunk.nextOffset);
        }
        if (chunk.complete && !reloadTriggered.current) {
          reloadTriggered.current = true;
          // Small grace period so the user sees the last few log lines.
          setTimeout(() => window.location.reload(), 2500);
        }
      } catch {
        // API unreachable — almost certainly the backend container is
        // being recreated. Keep polling; it'll come back.
        setReconnecting(true);
      }
    };

    const interval = setInterval(tick, 1500);
    tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [offset]);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [log]);

  return (
    <div className="flex flex-col gap-3">
      {reconnecting ? (
        <p className="text-sm text-amber-700">
          Reconnecting… the backend is restarting as part of the update.
        </p>
      ) : (
        <p className="text-sm text-slate-600">
          Update in progress. Do not close this page — it will reload automatically when the update
          finishes.
        </p>
      )}
      <pre
        ref={logBoxRef}
        className="h-72 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100"
      >
        {log || 'waiting for output…'}
      </pre>
    </div>
  );
}
