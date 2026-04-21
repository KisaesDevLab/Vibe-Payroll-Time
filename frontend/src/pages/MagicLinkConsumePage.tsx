// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthResponse } from '@vibept/shared';
import { useApplianceName } from '../hooks/useApplianceName';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';

/**
 * Landing page for magic-link emails / SMS. Reads ?token= from the URL,
 * POSTs it to /auth/magic/consume, stores the session, and redirects to
 * the dashboard. If the token is bad/expired, shows an error + a link
 * back to /login.
 *
 * Runs at most once per mount (StrictMode double-invoke guard) — a
 * token is single-use, so calling consume twice returns "expired" on
 * the second call even when both are valid.
 */
export function MagicLinkConsumePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const applianceName = useApplianceName();
  const token = params.get('token');
  const [state, setState] = useState<'consuming' | 'failed'>('consuming');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setErrorMsg('No token in the link.');
      setState('failed');
      return;
    }

    apiFetch<AuthResponse>('/auth/magic/consume', {
      method: 'POST',
      anonymous: true,
      body: JSON.stringify({ token }),
    })
      .then((session) => {
        authStore.set(session);
        navigate('/', { replace: true });
      })
      .catch((err) => {
        setErrorMsg(err instanceof ApiError ? err.message : 'Invalid or expired login link');
        setState('failed');
      });
  }, [token, navigate]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{applianceName}</h1>
      </header>
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        {state === 'consuming' ? (
          <p className="text-sm text-slate-600">Signing you in…</p>
        ) : (
          <>
            <p className="text-sm text-red-700">{errorMsg ?? 'Could not sign you in.'}</p>
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
            >
              Back to sign in
            </button>
          </>
        )}
      </div>
    </main>
  );
}
