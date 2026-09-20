// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { AuthSettingsPage } from '@kisaesdevlab/vibe-auth/react';
import { Link } from 'react-router-dom';
import { TopBar } from '../components/TopBar';
import { apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { SSO_BASE_PATH } from '../lib/sso';

/**
 * Appliance → Authentication (SuperAdmin only): single sign-on mode,
 * identity-provider connection, group → role mapping and the break-glass
 * status. The form itself is the shared @kisaesdevlab/vibe-auth component;
 * this page supplies the session and the Tailwind classes.
 *
 * The component talks to GET/PUT <base>/auth/settings and assumes cookie
 * sessions. Ours are bearer tokens with a 15-minute life, so its fetch is
 * wrapped: if the access token is about to expire, one ordinary API call
 * goes first — apiFetch's 401 → refresh dance rotates the session — and
 * the request then carries whatever token the store holds. The server
 * gates the same endpoints on `super_admin`; the route guard here is
 * only for navigation.
 */
const authedFetch: typeof fetch = async (input, init) => {
  const expiresAt = Date.parse(authStore.get()?.accessTokenExpiresAt ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < 30_000) {
    await apiFetch('/auth/me').catch(() => undefined);
  }
  const token = authStore.get()?.accessToken;
  return fetch(input, {
    ...init,
    headers: {
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
};

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';
const buttonBase =
  'rounded-md px-3 py-1.5 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50';

export function AuthenticationSettingsPage() {
  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Authentication</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Single sign-on through the firm&apos;s identity provider, for staff accounts.
              Passwords and login links keep working until the mode is set to SSO only. Kiosk PIN
              and badge punches are never affected.
            </p>
            {/* The shared form below suggests `npx vibe-auth breakglass ensure`,
                which cannot load this image's TypeScript adapter. */}
            <p className="mt-2 max-w-3xl text-xs text-slate-500">
              The break-glass account is provisioned from the server, not from this page: on the
              Vibe Appliance by <code>sudo vibe identity register vibe-payroll</code>; standalone,
              with the command in <code>docs/sso.md</code>. It signs in at <code>/login/local</code>
              .
            </p>
          </div>
          <Link
            to="/appliance"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
          >
            ← Appliance
          </Link>
        </header>

        <AuthSettingsPage
          basePath={SSO_BASE_PATH}
          productName="Payroll & Time"
          fetch={authedFetch}
          classNames={{
            root: 'grid max-w-3xl gap-6 text-slate-900',
            section: 'grid gap-3 rounded-lg border border-slate-200 bg-white p-6 shadow-sm',
            label: 'grid gap-1 text-sm text-slate-700',
            input: inputCls,
            button: `${buttonBase} border border-slate-300 bg-white text-slate-900 hover:bg-slate-50`,
            buttonPrimary: `${buttonBase} bg-slate-900 text-white hover:bg-slate-800`,
            buttonDanger: `${buttonBase} bg-red-600 text-white hover:bg-red-700`,
            table: 'w-full text-sm',
            note: 'text-xs text-slate-500',
            error: 'text-sm text-red-700',
          }}
        />
      </main>
    </>
  );
}
