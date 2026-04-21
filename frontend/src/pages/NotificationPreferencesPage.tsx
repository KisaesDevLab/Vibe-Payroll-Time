// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmployeePreferences } from '@vibept/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { TopBar } from '../components/TopBar';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { notifications } from '../lib/resources';

/**
 * Employee self-service: email opt-in, phone verification, SMS
 * opt-in. SMS toggle is gated on a verified phone — the backend
 * returns 403 if you try to flip it without verification.
 */
export function NotificationPreferencesPage() {
  const session = useSession();
  const memberships = useMemo(() => session?.user.memberships ?? [], [session]);
  const [companyId, setCompanyId] = useState<number | null>(memberships[0]?.companyId ?? null);
  useEffect(() => {
    if (!companyId && memberships[0]) setCompanyId(memberships[0].companyId);
  }, [companyId, memberships]);

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
              onChange={(e) => setCompanyId(Number(e.target.value))}
            >
              {memberships.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.companyName}
                </option>
              ))}
            </select>
          </label>
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
          <PhoneVerificationCard companyId={companyId} prefs={prefs.data} onVerified={invalidate} />
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
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input
          type="checkbox"
          className="sr-only"
          checked={enabled}
          disabled={disabled || busy}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span
          className={
            'h-6 w-11 rounded-full transition ' +
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
