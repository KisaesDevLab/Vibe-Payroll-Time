import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AuthResponse,
  LoginRequest,
  MagicLinkOptionsResponse,
  MagicLinkRequest,
} from '@vibept/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';

/**
 * Unified sign-in page. Three paths, all optional:
 *   - Password: always available.
 *   - Email magic link: shown when the appliance has EmailIt configured.
 *   - SMS magic link: shown when at least one company has Twilio configured.
 *
 * The options endpoint is public (the page needs it before the user is
 * authenticated) and returns `{ emailEnabled, smsEnabled }`.
 */

type MagicChannel = 'email' | 'sms';

export function LoginPage() {
  const navigate = useNavigate();
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
  const [magicIdentifier, setMagicIdentifier] = useState('');
  const [magicSent, setMagicSent] = useState(false);

  const requestMagic = useMutation({
    mutationFn: (body: MagicLinkRequest) =>
      apiFetch<void>('/auth/magic/request', {
        method: 'POST',
        anonymous: true,
        body: JSON.stringify(body),
      }),
    onSuccess: () => setMagicSent(true),
  });

  const showEmail = options.data?.emailEnabled ?? false;
  const showSms = options.data?.smsEnabled ?? false;
  const showAnyMagic = showEmail || showSms;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vibe Payroll Time</h1>
        <p className="mt-1 text-sm text-slate-600">Sign in to continue</p>
      </header>

      {magicChannel ? (
        <MagicLinkForm
          channel={magicChannel}
          identifier={magicIdentifier}
          onIdentifierChange={setMagicIdentifier}
          onSubmit={() =>
            requestMagic.mutate({ channel: magicChannel, identifier: magicIdentifier })
          }
          onBack={() => {
            setMagicChannel(null);
            setMagicSent(false);
            setMagicIdentifier('');
          }}
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
              label="Email"
              type="email"
              autoComplete="email"
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
                    onClick={() => setMagicChannel('email')}
                    className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
                  >
                    Email me a login link
                  </button>
                )}
                {showSms && (
                  <button
                    type="button"
                    onClick={() => setMagicChannel('sms')}
                    className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-100"
                  >
                    Text me a login link
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}

function MagicLinkForm({
  channel,
  identifier,
  onIdentifierChange,
  onSubmit,
  onBack,
  sent,
  pending,
}: {
  channel: MagicChannel;
  identifier: string;
  onIdentifierChange: (v: string) => void;
  onSubmit: () => void;
  onBack: () => void;
  sent: boolean;
  pending: boolean;
}) {
  if (sent) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <h2 className="text-base font-semibold text-emerald-900">Check your {channel}</h2>
        <p className="text-sm text-emerald-900">
          If an account matches <span className="font-mono">{identifier}</span>, a login link is on
          its way. It's valid for 15 minutes and can only be used once.
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
        {channel === 'email' ? 'Email me a login link' : 'Text me a login link'}
      </h2>
      <p className="text-sm text-slate-600">
        Enter the {channel === 'email' ? 'email address' : 'phone number'} on your account. We'll
        send a one-tap sign-in link.
      </p>
      <FormField
        label={channel === 'email' ? 'Email' : 'Phone'}
        type={channel === 'email' ? 'email' : 'tel'}
        autoComplete={channel === 'email' ? 'email' : 'tel'}
        required
        value={identifier}
        onChange={(e) => onIdentifierChange(e.target.value)}
      />
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
