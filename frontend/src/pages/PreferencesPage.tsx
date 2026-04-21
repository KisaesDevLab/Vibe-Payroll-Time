// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChangePasswordRequest,
  SetPasswordAfterMagicLinkRequest,
  TimeFormat,
} from '@vibept/shared';
import { formatHours } from '@vibept/shared';
import { useState } from 'react';
import { Button } from '../components/Button';
import { FormatToggle } from '../components/FormatToggle';
import { FormField } from '../components/FormField';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { decodeAccessToken } from '../lib/access-token-claims';
import { ApiError, apiFetch } from '../lib/api';
import { userPhone, userPreferences } from '../lib/resources';

/**
 * Per-user settings. Single field today — time format preference. Lives
 * as its own page so future additions (email display density, timezone
 * override, etc.) have a natural home.
 */
export function PreferencesPage(): JSX.Element {
  const qc = useQueryClient();

  const prefsQ = useQuery({
    queryKey: ['me-prefs'],
    queryFn: () => userPreferences.get(),
  });

  const update = useMutation({
    mutationFn: (next: TimeFormat | null) => userPreferences.update({ timeFormatPreference: next }),
    onSuccess: (data) => {
      qc.setQueryData(['me-prefs'], data);
      // Grids cache the effective format in their response; bust them.
      qc.invalidateQueries({ queryKey: ['weekly-grid'] });
      qc.invalidateQueries({ queryKey: ['multi-grid'] });
    },
  });

  const effective: TimeFormat = prefsQ.data?.timeFormatEffective ?? 'decimal';
  const inheriting = prefsQ.data?.timeFormatPreference == null;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Preferences</h1>
          <p className="mt-1 text-sm text-slate-600">
            Applies to your account across every company.
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Time format</h2>
              <p className="mt-1 text-sm text-slate-600">
                How hours render throughout the app. Storage is always exact seconds, so switching
                never changes your data.
              </p>
            </div>
            <FormatToggle
              value={effective}
              onChange={(next) => update.mutate(next)}
              disabled={update.isPending || prefsQ.isLoading}
            />
          </div>

          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-wider text-slate-500">Live preview</div>
            <div className="mt-2 grid grid-cols-3 gap-4 text-sm">
              <Sample seconds={0} format={effective} label="No time" />
              <Sample seconds={5 * 3600 + 48 * 60} format={effective} label="5h 48m" />
              <Sample seconds={8 * 3600} format={effective} label="Full day" />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {inheriting ? 'Using the company default.' : 'Overriding the company default.'}
            </span>
            {!inheriting && (
              <button
                type="button"
                onClick={() => update.mutate(null)}
                disabled={update.isPending}
                className="text-xs uppercase tracking-wider text-slate-500 hover:text-slate-900 disabled:opacity-50"
              >
                Reset to company default
              </button>
            )}
          </div>

          {update.error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {update.error instanceof ApiError
                ? update.error.message
                : 'Could not save preference.'}
            </div>
          )}
        </section>

        <ChangePasswordCard />
        <PhoneNotificationsCard />
      </main>
    </>
  );
}

function PhoneNotificationsCard(): JSX.Element {
  const session = useSession();
  const qc = useQueryClient();
  const companyCount = session?.user.memberships.length ?? 0;

  const state = useQuery({
    queryKey: ['user-phone'],
    queryFn: () => userPhone.get(),
  });

  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const editing = phoneDraft !== null;
  const effectivePhone = editing ? phoneDraft : (state.data?.phone ?? '');

  const save = useMutation({
    mutationFn: (phone: string | null) => userPhone.set({ phone }),
    onSuccess: () => {
      setPhoneDraft(null);
      setCode('');
      qc.invalidateQueries({ queryKey: ['user-phone'] });
    },
  });

  const request = useMutation({
    mutationFn: () => userPhone.requestCode(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-phone'] }),
  });

  const confirmMut = useMutation({
    mutationFn: (c: string) => userPhone.confirm({ code: c }),
    onSuccess: () => {
      setCode('');
      qc.invalidateQueries({ queryKey: ['user-phone'] });
    },
  });

  const awaitingCode = !!state.data?.pendingCodeExpiresAt;
  const verified = !!state.data?.phoneVerified;

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">Your phone (appliance-wide)</h2>
      <p className="mt-1 text-sm text-slate-600">
        Used for appliance-wide SMS — separate from the per-company phone an admin sets on your
        employee record. Verification sends a 6-digit code via the appliance's SMS provider.
      </p>

      {state.data && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <FormField
                label="Phone number"
                type="tel"
                autoComplete="tel"
                placeholder="+15555550123"
                value={effectivePhone ?? ''}
                onChange={(e) => setPhoneDraft(e.target.value)}
              />
            </div>
            {editing ? (
              <>
                <Button
                  onClick={() => save.mutate(phoneDraft?.trim() ? phoneDraft.trim() : null)}
                  loading={save.isPending}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setPhoneDraft(null);
                    save.reset();
                  }}
                  disabled={save.isPending}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setPhoneDraft(state.data?.phone ?? '')}>
                Edit
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            {verified ? (
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">Verified</span>
            ) : state.data.phone ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">Not verified</span>
            ) : (
              <span className="text-slate-500">No phone on file</span>
            )}
            {!state.data.smsAvailable && (
              <span className="text-slate-500">
                Appliance SMS provider not set — a SuperAdmin must configure Twilio or TextLinkSMS
                before verification works.
              </span>
            )}
          </div>

          {!verified && state.data.phone && !editing && state.data.smsAvailable && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              {!awaitingCode ? (
                <Button
                  onClick={() => request.mutate()}
                  loading={request.isPending}
                  variant="secondary"
                >
                  Send verification code
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <FormField
                    label="Enter 6-digit code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                  <div className="flex gap-2">
                    <Button
                      onClick={() => confirmMut.mutate(code)}
                      disabled={code.length !== 6}
                      loading={confirmMut.isPending}
                    >
                      Verify
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => request.mutate()}
                      disabled={request.isPending}
                    >
                      Resend
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {(save.error || request.error || confirmMut.error) && (
            <p className="text-xs text-red-700">
              {((save.error ?? request.error ?? confirmMut.error) as Error | null)?.message}
            </p>
          )}
        </div>
      )}

      {companyCount > 0 && (
        <div className="mt-6 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-900">Per-company phone</h3>
          <p className="mt-1 text-xs text-slate-600">
            You're an employee at {companyCount === 1 ? '1 company' : `${companyCount} companies`}.
            Each employee record has its own phone number, verified via that company's SMS provider
            — handy if your work phone differs from the number on this page.
          </p>
          <a
            href="/notifications"
            className="mt-2 inline-flex items-center text-xs font-medium text-slate-700 underline hover:text-slate-900"
          >
            Manage per-company phones →
          </a>
        </div>
      )}
    </section>
  );
}

function ChangePasswordCard(): JSX.Element {
  const session = useSession();
  const claims = decodeAccessToken(session?.accessToken);
  const viaMagicLink = claims?.authMethod === 'magic_link';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: (body: ChangePasswordRequest | SetPasswordAfterMagicLinkRequest) => {
      if (viaMagicLink) {
        return apiFetch<void>('/auth/set-password', {
          method: 'POST',
          body: JSON.stringify({
            newPassword: (body as SetPasswordAfterMagicLinkRequest).newPassword,
          }),
        });
      }
      return apiFetch<void>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
      setDone(true);
    },
  });

  const mismatch = newPassword.length > 0 && confirm.length > 0 && newPassword !== confirm;
  const tooShort = newPassword.length > 0 && newPassword.length < 12;
  const canSubmit =
    (viaMagicLink || currentPassword.length > 0) &&
    newPassword.length >= 12 &&
    newPassword === confirm &&
    (viaMagicLink || newPassword !== currentPassword);

  return (
    <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">
        {viaMagicLink ? 'Set a new password' : 'Change password'}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        {viaMagicLink
          ? 'You signed in with a magic link, so you can set a new password without entering the current one. After saving, your other sessions are signed out.'
          : 'Forgotten your password? Sign out and use the "Email me a login link" option on the sign-in page instead — after signing in that way, you can set a new password here without knowing the old one.'}
      </p>

      <form
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          if (!canSubmit) return;
          if (viaMagicLink) {
            change.mutate({ newPassword });
          } else {
            change.mutate({ currentPassword, newPassword });
          }
        }}
      >
        {!viaMagicLink && (
          <FormField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setDone(false);
            }}
            required
          />
        )}
        <FormField
          label="New password"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            setDone(false);
          }}
          hint="At least 12 characters."
          required
        />
        <FormField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setDone(false);
          }}
          required
        />

        {tooShort && (
          <p className="text-xs text-red-700">New password must be at least 12 characters.</p>
        )}
        {mismatch && <p className="text-xs text-red-700">Confirmation doesn't match.</p>}
        {!viaMagicLink && newPassword.length > 0 && currentPassword === newPassword && (
          <p className="text-xs text-red-700">New password must differ from the current one.</p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!canSubmit} loading={change.isPending}>
            Update password
          </Button>
          {done && !change.isPending && (
            <span className="text-sm text-emerald-700">
              Password updated. Other sessions signed out.
            </span>
          )}
        </div>

        {change.error && !change.isPending && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {change.error instanceof ApiError ? change.error.message : 'Could not change password.'}
          </div>
        )}
      </form>
    </section>
  );
}

function Sample({
  seconds,
  format,
  label,
}: {
  seconds: number;
  format: TimeFormat;
  label: string;
}): JSX.Element {
  return (
    <div className="rounded bg-white px-3 py-2 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-lg text-slate-900">{formatHours(seconds, format)}</div>
    </div>
  );
}
