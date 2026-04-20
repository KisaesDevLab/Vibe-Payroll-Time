import { useQuery } from '@tanstack/react-query';
import type { HealthResponse, VersionResponse } from '@vibept/shared';
import { Button } from '../components/Button';
import { useSession } from '../hooks/useSession';
import { apiFetch, ApiError } from '../lib/api';
import { authStore } from '../lib/auth-store';

function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/health', { anonymous: true }),
    refetchInterval: 15_000,
  });
}

function useVersion() {
  return useQuery({
    queryKey: ['version'],
    queryFn: () => apiFetch<VersionResponse>('/version', { anonymous: true }),
  });
}

export function HomePage() {
  const session = useSession();
  const health = useHealth();
  const version = useVersion();

  const logout = async () => {
    const refreshToken = session?.refreshToken;
    try {
      await apiFetch('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // logout is best-effort; always clear local state regardless
    }
    authStore.set(null);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
            Vibe Payroll Time
          </h1>
          {session ? (
            <p className="mt-2 text-slate-600">
              Signed in as <span className="font-medium">{session.user.email}</span>
              {session.user.roleGlobal === 'super_admin' && (
                <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">
                  SuperAdmin
                </span>
              )}
            </p>
          ) : (
            <p className="mt-2 text-slate-600">Not signed in.</p>
          )}
        </div>
        {session && (
          <Button variant="secondary" onClick={logout}>
            Sign out
          </Button>
        )}
      </header>

      {session && session.user.memberships.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Your companies</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {session.user.memberships.map((m) => (
              <li key={m.companyId} className="flex items-center justify-between py-2 text-sm">
                <span className="font-medium text-slate-800">{m.companyName}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {m.role.replace('_', ' ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
