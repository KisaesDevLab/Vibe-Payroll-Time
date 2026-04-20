import { useQuery } from '@tanstack/react-query';
import type { HealthResponse, VersionResponse } from '@vibept/shared';
import { apiFetch, ApiError } from '../lib/api';

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health'),
    refetchInterval: 15_000,
  });
}

function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => apiFetch<VersionResponse>('/version'),
  });
}

export function HomePage() {
  const health = useHealth();
  const version = useVersion();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Vibe Payroll Time
        </h1>
        <p className="mt-2 text-slate-600">
          Self-hosted employee time tracking. Scaffolded — Phase 0 complete.
        </p>
      </header>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Backend connectivity</h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="font-medium text-slate-500">Health</dt>
          <dd className="text-slate-800">
            {health.isPending && 'checking…'}
            {health.isError && (
              <span className="text-red-600">
                {health.error instanceof ApiError
                  ? `${health.error.code}: ${health.error.message}`
                  : 'unavailable'}
              </span>
            )}
            {health.data && (
              <span className="text-emerald-700">
                {health.data.status} · uptime {health.data.uptimeSeconds}s
              </span>
            )}
          </dd>

          <dt className="font-medium text-slate-500">Version</dt>
          <dd className="text-slate-800">
            {version.isPending && '…'}
            {version.isError && <span className="text-red-600">unavailable</span>}
            {version.data && (
              <span>
                v{version.data.version}{' '}
                <span className="text-slate-400">({version.data.gitSha.slice(0, 7)})</span>
              </span>
            )}
          </dd>
        </dl>
      </section>

      <footer className="mt-auto text-xs text-slate-400">
        PolyForm Internal Use 1.0.0 · KisaesDevLab
      </footer>
    </main>
  );
}
