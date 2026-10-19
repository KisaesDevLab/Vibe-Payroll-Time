// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { LoginPanel } from '@kisaesdevlab/vibe-auth/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AuthResponse,
  LoginRequest,
  MagicLinkOptionsResponse,
  MagicLinkRequest,
} from '@vibept/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { useApplianceName } from '../hooks/useApplianceName';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { SSO_BASE_PATH, takeSsoHandoffError } from '../lib/sso';

/**
 * Unified sign-in page. Three paths, all optional:
 *   - Password: always available.
 *   - Email magic link: shown when the appliance has EmailIt configured.
 *   - SMS magic link: shown when at least one company has Twilio configured.
 *
 * The options endpoint is public (the page needs it before the user is
 * authenticated) and returns `{ emailEnabled, smsEnabled }`.
 *
 * Three variants, one per route, so the people who use the app most —
 * client-company admins, supervisors and employees — never meet single
 * sign-on:
 *
 *   - `/login` (standard): the product's own forms only, in every mode. No
 *     identity-provider button. A firm user refused here under oidc_only
 *     gets a link to /firm.
 *   - `/firm` (firm): the firm's staff sign-in. <LoginPanel> reads GET
 *     /auth/status and shows the "Sign in with …" button when SSO is on,
 *     the local forms beside it in `local` / `both`, and hides them once
 *     the firm has gone SSO-only. The SSO flow ends on a redirect back here
 *     carrying the session in the URL fragment, which main.tsx consumes
 *     before this page ever renders (lib/sso.ts).
 *   - `/login/local` (breakglass): the password form even in SSO-only
 *     mode, for the one account that may still use it. The magic-link
 *     options are dropped — the break-glass address is undeliverable.
 */

type MagicChannel = 'email' | 'sms';

/** Which flow the identifier form is collecting for. `login` mints a
 *  sign-in link; `password_reset` mints one that lands on /auth/reset
 *  and forces a new password before letting the user through. */
type LinkFlow = 'login' | 'password_reset';

export type LoginVariant = 'standard' | 'firm' | 'breakglass';

/** The firm's staff sign-in route (single sign-on). */
export const FIRM_LOGIN_PATH = '/firm';

export function LoginPage({ variant = 'standard' }: { variant?: LoginVariant }) {
  const breakglass = variant === 'breakglass';
  const navigate = useNavigate();
  const [ssoError] = useState(takeSsoHandoffError);
  const applianceName = useApplianceName();
  const [form, setForm] = useState<LoginRequest>({
    email: '',
    password: '',
    rememberDevice: false,
  });

  const options = useQuery({
    queryKey: ['magic-options'],
    queryFn: () => apiFetch<MagicLinkOptionsResponse>('/auth/magic/options', { anonymous: true }),
    retry: false,
    staleTime: 60_000,
  });

  const login = useMutation({
    mutationFn: (payload: LoginRequest) =>
      apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        anonymous: true,
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      authStore.set(data);
      navigate('/', { replace: true });
    },
  });

  const [magicChannel, setMagicChannel] = useState<MagicChannel | null>(null);
  const [magicFlow, setMagicFlow] = useState<LinkFlow>('login');
  const [magicIdentifier, setMagicIdentifier] = useState('');
  const [magicSent, setMagicSent] = useState(false);

  const requestMagic = useMutation({
    mutationFn: ({ flow, ...body }: MagicLinkRequest & { flow: LinkFlow }) =>
      apiFetch<void>(
        flow === 'password_reset' ? '/auth/password-reset/request' : '/auth/magic/request',
        {
          method: 'POST',
          anonymous: true,
          body: JSON.stringify(body),
        },
      ),
    // Both endpoints 204 whether or not the identifier matched, so
    // "sent" here means "the request was accepted" — never "an account
    // exists". The confirmation copy is worded to match.
    onSuccess: () => setMagicSent(true),
  });

  const startFlow = (channel: MagicChannel, flow: LinkFlow) => {
    setMagicChannel(channel);
    setMagicFlow(flow);
    setMagicSent(false);
  };

  const showEmail = !breakglass && (options.data?.emailEnabled ?? false);
  const showSms = !breakglass && (options.data?.smsEnabled ?? false);
  const showAnyMagic = showEmail || showSms;

  // The product's own forms, exactly as before SSO existed. On /firm they
  // are handed to <LoginPanel> as children so it can hide the lot in
  // SSO-only mode.
  const localSignIn = magicChannel ? (
    <MagicLinkForm
      channel={magicChannel}
      flow={magicFlow}
      identifier={magicIdentifier}
      onIdentifierChange={setMagicIdentifier}
      onSubmit={() =>
        requestMagic.mutate({
          flow: magicFlow,
          channel: magicChannel,
          identifier: magicIdentifier,
          // Tell the backend where we live so the link URL points
          // at the frontend, not the backend API host. Ignored
          // server-side when not on the CORS allowlist, so it
          // can't be abused to redirect the link.
          origin: window.location.origin,
        })
      }
      onBack={() => {
        setMagicChannel(null);
        setMagicSent(false);
        setMagicIdentifier('');
      }}
      onSwitchChannel={
        showEmail && showSms
          ? () => {
              setMagicChannel(magicChannel === 'email' ? 'sms' : 'email');
              setMagicIdentifier('');
            }
          : undefined
      }
      sent={magicSent}
      pending={requestMagic.isPending}
    />
  ) : (
    <>
      <form
        className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate(form);
        }}
      >
        <FormField
          // The break-glass account signs in by username, which the
          // browser's own email validation would reject.
          label={breakglass ? 'Email or break-glass username' : 'Email'}
          type={breakglass ? 'text' : 'email'}
          autoComplete={breakglass ? 'username' : 'email'}
          required
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
        <FormField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
        />
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={!!form.rememberDevice}
            onChange={(e) => setForm((f) => ({ ...f, rememberDevice: e.target.checked }))}
          />
          Remember this device
        </label>

        {login.isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {login.error instanceof ApiError
              ? login.error.message
              : 'Sign in failed — please retry.'}
            {login.error instanceof ApiError &&
              login.error.code === 'local_login_disabled' &&
              variant === 'standard' && (
                <>
                  {' '}
                  <Link to={FIRM_LOGIN_PATH} className="font-medium underline">
                    Go to firm sign-in
                  </Link>
                </>
              )}
          </div>
        )}

        <Button type="submit" loading={login.isPending}>
          Sign in
        </Button>
      </form>

      {showAnyMagic && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
            Or sign in without a password
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {showEmail && (
              <button
                type="button"
                onClick={() => startFlow('email', 'login')}
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
              >
                Email me a login link
              </button>
            )}
            {showSms && (
              <button
                type="button"
                onClick={() => startFlow('sms', 'login')}
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
              >
                Text me a login link
              </button>
            )}
          </div>

          {/* Password reset rides the same transports. Offered only
                  when at least one is configured — an appliance with
                  neither has no way to prove mailbox control, so the
                  only recovery path is an admin resetting it for them
                  (documented in docs/admin-guide.md). */}
          <div className="mt-1 border-t border-slate-200 pt-2 text-center">
            <button
              type="button"
              onClick={() => startFlow(showEmail ? 'email' : 'sms', 'password_reset')}
              className="text-sm text-slate-600 underline hover:text-slate-900"
            >
              Forgot your password?
            </button>
          </div>
        </div>
      )}

      {!showAnyMagic && !breakglass && (
        <p className="text-center text-xs text-slate-500">
          Forgot your password? Ask your administrator to reset it — this appliance has no email or
          SMS transport configured for self-service recovery.
        </p>
      )}
    </>
  );

  const subtitle =
    variant === 'breakglass'
      ? 'Break-glass sign-in with a local password'
      : variant === 'firm'
        ? 'Firm staff sign-in'
        : 'Sign in to continue';

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{applianceName}</h1>
        <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
      </header>

      {ssoError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {ssoError}
        </div>
      )}

      {variant === 'standard' ? (
        <div className="flex flex-col gap-6">{localSignIn}</div>
      ) : (
        <LoginPanel
          basePath={SSO_BASE_PATH}
          // Anywhere works — main.tsx reads the session off the fragment
          // before routing — but /firm renders without a session if the
          // hand-off fails, and it is where the person started.
          returnTo={`${SSO_BASE_PATH}${FIRM_LOGIN_PATH}`}
          breakglass={breakglass}
          classNames={{
            root: 'flex flex-col gap-6',
            button:
              'block rounded-md bg-slate-900 px-4 py-2.5 text-center text-sm font-medium text-white shadow-sm hover:bg-slate-800 aria-disabled:opacity-60',
            divider: 'text-center text-xs font-medium uppercase tracking-widest text-slate-400',
            note: 'text-center text-xs text-slate-500',
          }}
        >
          {localSignIn}
        </LoginPanel>
      )}

      {variant === 'firm' && (
        <p className="text-center text-xs text-slate-500">
          Not on the firm&apos;s staff?{' '}
          <Link to="/login" className="underline hover:text-slate-900">
            Sign in here
          </Link>
          .
        </p>
      )}
    </main>
  );
}

function MagicLinkForm({
  channel,
  flow,
  identifier,
  onIdentifierChange,
  onSubmit,
  onBack,
  onSwitchChannel,
  sent,
  pending,
}: {
  channel: MagicChannel;
  flow: LinkFlow;
  identifier: string;
  onIdentifierChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  /** Only supplied when both transports are configured. */
  onSwitchChannel?: (() => void) | undefined;
  sent: boolean;
  pending: boolean;
}) {
  const isReset = flow === 'password_reset';

  if (sent) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-emerald-900">
          Check your {channel === 'email' ? 'email' : 'phone'}
        </h2>
        {/* Deliberately conditional ("if an account matches") — the
            server 204s either way, and promising delivery would turn
            this page into an account-enumeration oracle. */}
        <p className="text-sm text-emerald-900">
          If an account matches <span className="font-mono">{identifier}</span>, a{' '}
          {isReset ? 'password reset' : 'login'} link is on its way. It's valid for{' '}
          {isReset ? '30' : '15'} minutes and can only be used once.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="self-start text-sm text-emerald-900 underline"
        >
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (identifier.trim()) onSubmit();
      }}
    >
      <h2 className="text-base font-semibold text-slate-900">
        {isReset
          ? 'Reset your password'
          : channel === 'email'
            ? 'Email me a login link'
            : 'Text me a login link'}
      </h2>
      <p className="text-sm text-slate-600">
        Enter the {channel === 'email' ? 'email address' : 'phone number'} on your account. We'll
        send {isReset ? 'a link to choose a new password' : 'a one-tap sign-in link'}.
      </p>
      <FormField
        label={channel === 'email' ? 'Email' : 'Phone'}
        type={channel === 'email' ? 'email' : 'tel'}
        autoComplete={channel === 'email' ? 'email' : 'tel'}
        required
        value={identifier}
        onChange={(e) => onIdentifierChange(e.target.value)}
      />
      {/* Reset is entered from a single "Forgot your password?" button,
          which has to guess a channel. Someone whose account has a
          phone but no email would otherwise be stranded on the wrong
          form with no way across. */}
      {onSwitchChannel && (
        <button
          type="button"
          onClick={onSwitchChannel}
          className="self-start text-xs text-slate-600 underline hover:text-slate-900"
        >
          {channel === 'email' ? 'Use my phone number instead' : 'Use my email address instead'}
        </button>
      )}

      <div className="flex justify-between gap-2">
        <button type="button" onClick={onBack} className="text-sm text-slate-600 hover:underline">
          ← Back
        </button>
        <Button type="submit" loading={pending} disabled={!identifier.trim()}>
          Send link
        </Button>
      </div>
    </form>
  );
}
