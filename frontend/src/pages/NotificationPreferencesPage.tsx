// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeePreferences } from '@vibept/shared';
import { useId, useState } from 'react';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { TopBar } from '../components/TopBar';
import { usePunchCompany } from '../hooks/usePunchCompany';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { notifications } from '../lib/resources';

/**
 * Employee self-service: email opt-in, phone verification, SMS
 * opt-in. SMS toggle is gated on a verified phone — the backend
 * returns 403 if you try to flip it without verification.
 *
 * Preferences live on the employee record, so only companies where the
 * person has one are offered (an admin-only membership has nothing to
 * set). Starts on the company they punch for; picking another here does
 * not change that.
 */
export function NotificationPreferencesPage() {
  const session = useSession();
  const { memberships, companyId: punchCompanyId } = usePunchCompany();
  const [picked, setPicked] = useState<number | null>(null);
  const companyId =
    picked != null && memberships.some((m) => m.companyId === picked) ? picked : punchCompanyId;

  const qc = useQueryClient();
  const prefs = useQuery({
    queryKey: ['prefs', companyId],
    queryFn: () => notifications.getPreferences(companyId!),
    enabled: companyId != null,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['prefs', companyId] });

  const toggleEmail = useMutation({
    mutationFn: (enabled: boolean) =>
      notifications.updatePreferences(companyId!, {
        emailNotificationsEnabled: enabled,
      }),
    onSuccess: invalidate,
  });
  const toggleSms = useMutation({
    mutationFn: (enabled: boolean) =>
      notifications.updatePreferences(companyId!, {
        smsNotificationsEnabled: enabled,
      }),
    onSuccess: invalidate,
  });

  if (!session) return null;

  return (
    <>
      <TopBar />
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-600">
            Choose how you're notified about missed punches, approvals, and correction decisions.
          </p>
        </header>

        {memberships.length > 1 && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Company</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={companyId ?? ''}
              onChange={(e) => setPicked(Number(e.target.value))}
            >
              {memberships.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.companyName}
                </option>
              ))}
            </select>
          </label>
        )}

        {memberships.length === 0 && (
          <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Notification settings belong to an employee record, and you don't have one at any
            company. Ask an administrator if you should.
          </p>
        )}

        {prefs.isPending && companyId != null && <p className="text-sm text-slate-500">Loading…</p>}
        {prefs.isError && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {prefs.error instanceof ApiError
              ? prefs.error.message
              : 'Could not load your notification settings.'}
          </div>
        )}

        {prefs.data && (
          <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <ToggleRow
              title="Email notifications"
              subtitle={prefs.data.email ?? 'no email on file — ask an admin to add one'}
              enabled={prefs.data.emailNotificationsEnabled}
              onToggle={(v) => toggleEmail.mutate(v)}
              busy={toggleEmail.isPending}
              disabled={!prefs.data.email}
            />
            {toggleEmail.isError && (
              <p className="text-xs text-red-700">
                {toggleEmail.error instanceof ApiError
                  ? toggleEmail.error.message
                  : 'Failed to update email preference.'}
              </p>
            )}

            <div className="border-t border-slate-100 pt-4">
              <ToggleRow
                title="SMS notifications"
                subtitle={
                  prefs.data.phoneVerified
                    ? (prefs.data.phone ?? 'verified')
                    : 'Verify your phone number below to enable SMS.'
                }
                enabled={prefs.data.smsNotificationsEnabled}
                onToggle={(v) => toggleSms.mutate(v)}
                busy={toggleSms.isPending}
                disabled={!prefs.data.phoneVerified}
              />
              {toggleSms.isError && (
                <p className="mt-2 text-xs text-red-700">
                  {toggleSms.error instanceof ApiError
                    ? toggleSms.error.message
                    : 'Failed to update SMS preference.'}
                </p>
              )}
            </div>
          </section>
        )}

        {companyId != null && prefs.data && (
          <PhoneVerificationCard
            // Fresh draft state per company: the phone field seeds from
            // that company's employee record.
            key={companyId}
            companyId={companyId}
            prefs={prefs.data}
            onVerified={invalidate}
          />
        )}
      </main>
    </>
  );
}

function ToggleRow({
  title,
  subtitle,
  enabled,
  onToggle,
  busy,
  disabled,
}: {
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const subtitleId = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p id={subtitleId} className="mt-0.5 text-xs text-slate-500">
          {subtitle}
        </p>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        {/* sr-only checkbox behind a drawn switch: give it a name, a
            switch role, and a visible focus ring on the track. */}
        <input
          type="checkbox"
          role="switch"
          aria-label={title}
          aria-describedby={subtitleId}
          className="peer sr-only"
          checked={enabled}
          disabled={disabled || busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span
          className={
            'h-6 w-11 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-slate-900 peer-focus-visible:ring-offset-2 ' +
            (enabled ? 'bg-emerald-500' : 'bg-slate-300') +
            (disabled ? ' opacity-50' : '')
          }
        />
        <span
          className={
            'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition ' +
            (enabled ? 'translate-x-5' : '')
          }
        />
      </label>
    </div>
  );
}

function PhoneVerificationCard({
  companyId,
  prefs,
  onVerified,
}: {
  companyId: number;
  prefs: EmployeePreferences;
  onVerified: () => void;
}) {
  const [phone, setPhone] = useState(prefs.phone ?? '');
  const [code, setCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);

  const request = useMutation({
    mutationFn: () => notifications.requestPhoneVerification(companyId, phone),
    onSuccess: () => {
      setAwaitingCode(true);
      setCode('');
    },
  });
  const confirm = useMutation({
    mutationFn: () => notifications.confirmPhoneVerification(companyId, code),
    onSuccess: () => {
      setAwaitingCode(false);
      setCode('');
      onVerified();
    },
  });

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h2 className="text-base font-semibold text-slate-900">Phone verification</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          A 6-digit code will be sent to your phone via SMS.
          {prefs.phoneVerified && ' Your current number is verified.'}
        </p>
      </header>

      <FormField
        label="Phone number"
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="+1 555 555 1234"
      />

      {awaitingCode && (
        <FormField
          label="Verification code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      )}

      {(request.isError || confirm.isError) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {((request.error ?? confirm.error) as Error | null)?.message ?? 'Verification failed'}
        </div>
      )}

      <div className="flex justify-end gap-2">
        {awaitingCode ? (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAwaitingCode(false);
                setCode('');
              }}
            >
              Cancel
            </Button>
            <Button
              loading={confirm.isPending}
              disabled={code.length !== 6}
              onClick={() => confirm.mutate()}
            >
              Confirm code
            </Button>
          </>
        ) : (
          <Button
            loading={request.isPending}
            disabled={phone.length < 7}
            onClick={() => request.mutate()}
          >
            Send code
          </Button>
        )}
      </div>
    </section>
  );
}
