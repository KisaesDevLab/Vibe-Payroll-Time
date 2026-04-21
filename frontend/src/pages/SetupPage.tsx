import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  SetupInitialRequest,
  SetupInitialResponse,
  SetupStatusResponse,
} from '@vibept/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { TimezoneOptions } from '../components/TimezoneOptions';
import { ApiError, apiFetch } from '../lib/api';
import { authStore } from '../lib/auth-store';

const TZ_GUESS = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';

export function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<SetupInitialRequest>({
    appliance: { timezone: TZ_GUESS },
    admin: { email: '', password: '' },
    company: {
      name: '',
      slug: '',
      timezone: TZ_GUESS,
      weekStartDay: 0,
      payPeriodType: 'bi_weekly',
    },
  });
  const [passwordConfirm, setPasswordConfirm] = useState('');

  const submit = useMutation({
    mutationFn: (payload: SetupInitialRequest) =>
      apiFetch<SetupInitialResponse>('/setup/initial', {
        method: 'POST',
        anonymous: true,
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      authStore.set(data);
      // Flip the cached setup-status to "done" so App.tsx renders the
      // authenticated route tree instead of bouncing us back to /setup.
      // Without this, navigate('/') lands on the setup-required catch-all
      // redirect and SetupPage remounts fresh at step 0.
      qc.setQueryData<SetupStatusResponse>(['setup-status'], (prev) => ({
        setupRequired: false,
        installationId: prev?.installationId ?? null,
      }));
      navigate('/', { replace: true });
    },
  });

  const canContinueStep0 = form.appliance.timezone.length > 0;
  const canContinueStep1 =
    form.admin.email.includes('@') &&
    form.admin.password.length >= 12 &&
    form.admin.password === passwordConfirm;
  const canContinueStep2 =
    form.company.name.length > 0 &&
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(form.company.slug) &&
    form.company.timezone.length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Set up your appliance
        </h1>
        <p className="mt-2 text-slate-600">
          First-run wizard. Takes about a minute. You can change every answer later.
        </p>
      </header>

      <ol className="flex items-center gap-3 text-xs font-medium text-slate-500">
        {['Appliance', 'Super admin', 'First company'].map((label, idx) => (
          <li
            key={label}
            className={
              'rounded-full px-3 py-1 ' +
              (idx === step
                ? 'bg-slate-900 text-white'
                : idx < step
                  ? 'bg-slate-200 text-slate-700'
                  : 'bg-slate-100')
            }
          >
            {idx + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Appliance default timezone</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={form.appliance.timezone}
              onChange={(e) => setForm((f) => ({ ...f, appliance: { timezone: e.target.value } }))}
            >
              <TimezoneOptions current={form.appliance.timezone} />
            </select>
            <span className="text-xs text-slate-500">
              Default for new companies created on this appliance. Each company can override its own
              timezone later.
            </span>
          </label>
          <div className="flex justify-end">
            <Button disabled={!canContinueStep0} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <FormField
            label="Email"
            type="email"
            autoComplete="email"
            value={form.admin.email}
            onChange={(e) =>
              setForm((f) => ({ ...f, admin: { ...f.admin, email: e.target.value } }))
            }
          />
          <FormField
            label="Password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters. Use a passphrase."
            value={form.admin.password}
            onChange={(e) =>
              setForm((f) => ({ ...f, admin: { ...f.admin, password: e.target.value } }))
            }
          />
          <FormField
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            error={
              passwordConfirm && passwordConfirm !== form.admin.password
                ? 'Passwords do not match'
                : undefined
            }
          />
          <FormField
            label="Phone number (optional)"
            type="tel"
            autoComplete="tel"
            placeholder="+15555550123"
            hint="E.164 format. Used later for appliance-wide SMS notifications. You can verify it after signing in."
            value={form.admin.phone ?? ''}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                admin: {
                  ...f.admin,
                  phone: e.target.value || undefined,
                },
              }))
            }
          />
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button disabled={!canContinueStep1} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <FormField
            label="Company name"
            hint="Your firm — the internal, staff-only company."
            value={form.company.name}
            onChange={(e) =>
              setForm((f) => ({ ...f, company: { ...f.company, name: e.target.value } }))
            }
          />
          <FormField
            label="Slug"
            hint="kebab-case identifier used in URLs."
            value={form.company.slug}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                company: { ...f.company, slug: e.target.value.toLowerCase() },
              }))
            }
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Timezone</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
              value={form.company.timezone}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  company: { ...f.company, timezone: e.target.value },
                }))
              }
            >
              <TimezoneOptions current={form.company.timezone} />
            </select>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Week starts on</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
                value={form.company.weekStartDay}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    company: { ...f.company, weekStartDay: Number(e.target.value) },
                  }))
                }
              >
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Pay period</span>
              <select
                className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
                value={form.company.payPeriodType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    company: {
                      ...f.company,
                      payPeriodType: e.target.value as typeof f.company.payPeriodType,
                    },
                  }))
                }
              >
                <option value="weekly">Weekly</option>
                <option value="bi_weekly">Bi-weekly</option>
                <option value="semi_monthly">Semi-monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
          {submit.isError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {submit.error instanceof ApiError
                ? submit.error.message
                : 'Setup failed — please retry.'}
            </div>
          )}
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              disabled={!canContinueStep2}
              loading={submit.isPending}
              onClick={() => submit.mutate(form)}
            >
              Create appliance
            </Button>
          </div>
        </section>
      )}
    </main>
  );
}
