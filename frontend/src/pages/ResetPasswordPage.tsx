// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AuthResponse } from '@vibept/shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { useApplianceName } from '../hooks/useApplianceName';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';

/**
 * Landing page for password-reset links, and for the "set your own
 * password" half of an admin-sent invite.
 *
 * Two steps behind one URL:
 *   1. Consume ?token= for a session. Identical call to the magic-link
 *      page — the token grants a session tagged `authMethod:
 *      'magic_link'`.
 *   2. Require a new password before going anywhere. That tag is
 *      exactly what /auth/set-password demands, so no current password
 *      is needed; the link itself was the proof.
 *
 * Step 2 is not optional. Landing here means the person either forgot
 * their password or never had one, so dropping them on the dashboard
 * with a working session and an unknown credential just guarantees
 * they're back at this page next week.
 *
 * After the password is set the server revokes every refresh token for
 * the user — including this page's. That's correct (a reset should
 * evict whoever might have been in the account) but it means the local
 * session is dead, so we clear it and send them to /login to sign in
 * fresh. Nothing lost: they now know their password.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const applianceName = useApplianceName();
  const token = params.get('token');

  const [stage, setStage] = useState<'consuming' | 'form' | 'invalid' | 'done'>('consuming');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  // StrictMode double-invoke guard — a token is single-use, so a second
  // consume would report "expired" on a perfectly good link.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setErrorMsg('No token in the link.');
      setStage('invalid');
      return;
    }

    apiFetch<AuthResponse>('/auth/magic/consume', {
      method: 'POST',
      anonymous: true,
      body: JSON.stringify({ token }),
    })
      .then((session) => {
        // Store it: /auth/set-password is an authenticated endpoint and
        // needs this access token on the next call.
        authStore.set(session);
        setEmail(session.user.email);
        setStage('form');
      })
      .catch((err) => {
        setErrorMsg(
          err instanceof ApiError ? err.message : 'This reset link is invalid or has expired.',
        );
        setStage('invalid');
      });
  }, [token]);

  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= 12 && confirm === password && !saving;

  const submit = async () => {
    setSaving(true);
    setErrorMsg(null);
    try {
      await apiFetch<void>('/auth/set-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: password }),
      });
      // Session is now dead server-side — see the file docblock.
      authStore.set(null);
      setStage('done');
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Could not set your password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{applianceName}</h1>
      </header>

      {stage === 'consuming' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-600">Checking your link…</p>
        </div>
      )}

      {stage === 'invalid' && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-red-700">{errorMsg}</p>
          <p className="mt-2 text-xs text-slate-500">
            Reset links expire after 30 minutes and work only once. Request a new one from the sign
            in page.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
          >
            Back to sign in
          </button>
        </div>
      )}

      {stage === 'form' && (
        <form
          className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <div>
            <h2 className="text-base font-semibold text-slate-900">Choose a password</h2>
            {email && (
              <p className="mt-1 text-sm text-slate-600">
                for <span className="font-mono">{email}</span>
              </p>
            )}
          </div>

          <FormField
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            hint="At least 12 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={tooShort ? 'Must be at least 12 characters' : undefined}
          />
          <FormField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch ? "Passwords don't match" : undefined}
          />

          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}

          <Button type="submit" loading={saving} disabled={!canSubmit}>
            Set password
          </Button>
        </form>
      )}

      {stage === 'done' && (
        <div className="flex flex-col gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-emerald-900">Password set</h2>
          <p className="text-sm text-emerald-900">
            Any other devices signed in to this account have been signed out. Sign in with your new
            password to continue.
          </p>
          <Button onClick={() => navigate('/login', { replace: true })}>Go to sign in</Button>
        </div>
      )}
    </main>
  );
}
