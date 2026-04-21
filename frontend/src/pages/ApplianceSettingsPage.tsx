// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplianceSettings,
  ApplianceSettingsSource,
  TunnelStatusResponse,
  UpdateApplianceSettingsRequest,
  UpdateTunnelRequest,
} from '@vibept/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { admin } from '../lib/resources';
import { ApiError } from '../lib/api';

/**
 * SuperAdmin appliance settings. Every operator-editable setting that
 * isn't crypto/ingress/DB lives here — EmailIt fallback, AI fallback,
 * pg_dump retention, log level.
 *
 * Source semantics:
 *   - "stored" badge means the value comes from the DB
 *   - "env fallback" badge means the value is coming from process.env
 *     because nothing is stored yet — saving in the UI overrides env
 *   - "not set" means neither is configured
 *
 * Saving sends only changed fields. Secret fields (API keys) require
 * explicit "Change" → type new value → Save; they never prefill.
 */

type SecretState =
  | { mode: 'unchanged' } // don't send
  | { mode: 'new'; value: string } // PATCH sends this string
  | { mode: 'clear' }; // PATCH sends null

interface FormState {
  displayName: string | null;
  displayNameDirty: boolean;
  emailit: {
    apiKey: SecretState;
    fromEmail: string | null;
    fromEmailDirty: boolean;
    fromName: string | null;
    fromNameDirty: boolean;
    apiBaseUrl: string | null;
    apiBaseUrlDirty: boolean;
  };
  sms: {
    provider: ApplianceSettings['sms']['provider'];
    providerDirty: boolean;
    twilioAccountSid: string | null;
    twilioAccountSidDirty: boolean;
    twilioAuthToken: SecretState;
    twilioFromNumber: string | null;
    twilioFromNumberDirty: boolean;
    textlinkApiKey: SecretState;
    textlinkFromNumber: string | null;
    textlinkFromNumberDirty: boolean;
    textlinkBaseUrl: string | null;
    textlinkBaseUrlDirty: boolean;
  };
  ai: {
    provider: ApplianceSettings['ai']['provider'];
    providerDirty: boolean;
    apiKey: SecretState;
    model: string | null;
    modelDirty: boolean;
    baseUrl: string | null;
    baseUrlDirty: boolean;
  };
  retentionDays: number;
  retentionDaysDirty: boolean;
  logLevel: ApplianceSettings['logLevel'];
  logLevelDirty: boolean;
}

function initialForm(s: ApplianceSettings): FormState {
  return {
    displayName: s.displayName,
    displayNameDirty: false,
    emailit: {
      apiKey: { mode: 'unchanged' },
      fromEmail: s.emailit.fromEmail,
      fromEmailDirty: false,
      fromName: s.emailit.fromName,
      fromNameDirty: false,
      apiBaseUrl: s.emailit.apiBaseUrl,
      apiBaseUrlDirty: false,
    },
    sms: {
      provider: s.sms.provider,
      providerDirty: false,
      twilioAccountSid: s.sms.twilio.accountSid,
      twilioAccountSidDirty: false,
      twilioAuthToken: { mode: 'unchanged' },
      twilioFromNumber: s.sms.twilio.fromNumber,
      twilioFromNumberDirty: false,
      textlinkApiKey: { mode: 'unchanged' },
      textlinkFromNumber: s.sms.textlinksms.fromNumber,
      textlinkFromNumberDirty: false,
      textlinkBaseUrl: s.sms.textlinksms.baseUrl,
      textlinkBaseUrlDirty: false,
    },
    ai: {
      provider: s.ai.provider,
      providerDirty: false,
      apiKey: { mode: 'unchanged' },
      model: s.ai.model,
      modelDirty: false,
      baseUrl: s.ai.baseUrl,
      baseUrlDirty: false,
    },
    retentionDays: s.retentionDays,
    retentionDaysDirty: false,
    logLevel: s.logLevel,
    logLevelDirty: false,
  };
}

function toPatch(f: FormState): UpdateApplianceSettingsRequest {
  const patch: UpdateApplianceSettingsRequest = {};

  if (f.displayNameDirty) {
    const trimmed = f.displayName?.trim();
    patch.displayName = trimmed ? trimmed : null;
  }

  const e: UpdateApplianceSettingsRequest['emailit'] = {};
  if (f.emailit.apiKey.mode === 'new') e.apiKey = f.emailit.apiKey.value;
  else if (f.emailit.apiKey.mode === 'clear') e.apiKey = null;
  if (f.emailit.fromEmailDirty)
    e.fromEmail = f.emailit.fromEmail?.trim() ? f.emailit.fromEmail.trim() : null;
  if (f.emailit.fromNameDirty)
    e.fromName = f.emailit.fromName?.trim() ? f.emailit.fromName.trim() : null;
  if (f.emailit.apiBaseUrlDirty)
    e.apiBaseUrl = f.emailit.apiBaseUrl?.trim() ? f.emailit.apiBaseUrl.trim() : null;
  if (Object.keys(e).length > 0) patch.emailit = e;

  const a: UpdateApplianceSettingsRequest['ai'] = {};
  if (f.ai.providerDirty) a.provider = f.ai.provider;
  if (f.ai.apiKey.mode === 'new') a.apiKey = f.ai.apiKey.value;
  else if (f.ai.apiKey.mode === 'clear') a.apiKey = null;
  if (f.ai.modelDirty) a.model = f.ai.model?.trim() ? f.ai.model.trim() : null;
  if (f.ai.baseUrlDirty) a.baseUrl = f.ai.baseUrl?.trim() ? f.ai.baseUrl.trim() : null;
  if (Object.keys(a).length > 0) patch.ai = a;

  const sms: NonNullable<UpdateApplianceSettingsRequest['sms']> = {};
  if (f.sms.providerDirty) sms.provider = f.sms.provider;
  const tw: NonNullable<typeof sms.twilio> = {};
  if (f.sms.twilioAccountSidDirty)
    tw.accountSid = f.sms.twilioAccountSid?.trim() ? f.sms.twilioAccountSid.trim() : null;
  if (f.sms.twilioAuthToken.mode === 'new') tw.authToken = f.sms.twilioAuthToken.value;
  else if (f.sms.twilioAuthToken.mode === 'clear') tw.authToken = null;
  if (f.sms.twilioFromNumberDirty)
    tw.fromNumber = f.sms.twilioFromNumber?.trim() ? f.sms.twilioFromNumber.trim() : null;
  if (Object.keys(tw).length > 0) sms.twilio = tw;

  const tl: NonNullable<typeof sms.textlinksms> = {};
  if (f.sms.textlinkApiKey.mode === 'new') tl.apiKey = f.sms.textlinkApiKey.value;
  else if (f.sms.textlinkApiKey.mode === 'clear') tl.apiKey = null;
  if (f.sms.textlinkFromNumberDirty)
    tl.fromNumber = f.sms.textlinkFromNumber?.trim() ? f.sms.textlinkFromNumber.trim() : null;
  if (f.sms.textlinkBaseUrlDirty)
    tl.baseUrl = f.sms.textlinkBaseUrl?.trim() ? f.sms.textlinkBaseUrl.trim() : null;
  if (Object.keys(tl).length > 0) sms.textlinksms = tl;

  if (Object.keys(sms).length > 0) patch.sms = sms;

  if (f.retentionDaysDirty) patch.retentionDays = f.retentionDays;
  if (f.logLevelDirty) patch.logLevel = f.logLevel;

  return patch;
}

function isDirty(f: FormState): boolean {
  return (
    f.displayNameDirty ||
    f.emailit.apiKey.mode !== 'unchanged' ||
    f.emailit.fromEmailDirty ||
    f.emailit.fromNameDirty ||
    f.emailit.apiBaseUrlDirty ||
    f.sms.providerDirty ||
    f.sms.twilioAccountSidDirty ||
    f.sms.twilioAuthToken.mode !== 'unchanged' ||
    f.sms.twilioFromNumberDirty ||
    f.sms.textlinkApiKey.mode !== 'unchanged' ||
    f.sms.textlinkFromNumberDirty ||
    f.sms.textlinkBaseUrlDirty ||
    f.ai.providerDirty ||
    f.ai.apiKey.mode !== 'unchanged' ||
    f.ai.modelDirty ||
    f.ai.baseUrlDirty ||
    f.retentionDaysDirty ||
    f.logLevelDirty
  );
}

export function ApplianceSettingsPage() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: admin.settings,
  });

  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (data && form === null) setForm(initialForm(data));
  }, [data, form]);

  const save = useMutation({
    mutationFn: admin.updateSettings,
    onSuccess: (next) => {
      qc.setQueryData(['admin-settings'], next);
      setForm(initialForm(next));
    },
  });

  const patch = useMemo(() => (form ? toPatch(form) : {}), [form]);
  const dirty = form ? isDirty(form) : false;

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <Link to="/appliance" className="text-xs text-slate-500 hover:underline">
              ← Appliance
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              Appliance settings
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Appliance-wide fallbacks for email, AI, backups, and logging. Changes apply
              immediately — no restart needed. Companies can still override individual email and AI
              config on their own settings pages.
            </p>
          </div>
        </header>

        {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {isError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Failed to load settings.
          </div>
        )}

        {data && form && (
          <form
            className="flex flex-col gap-6"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (dirty) save.mutate(patch);
            }}
          >
            <BrandingSection form={form} setForm={setForm} />
            <EmailItSection data={data} form={form} setForm={setForm} />
            <SmsSection data={data} form={form} setForm={setForm} />
            <AISection data={data} form={form} setForm={setForm} />
            <RetentionSection data={data} form={form} setForm={setForm} />
            <LogLevelSection data={data} form={form} setForm={setForm} />
            <DemoSeedSection />
            <TunnelSection />
            <LicenseSection />

            <div className="sticky bottom-4 flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-sm text-slate-600">
                {dirty ? (
                  <span className="text-amber-700">Unsaved changes</span>
                ) : (
                  <span>No changes</span>
                )}
                {save.isError && (
                  <span className="ml-3 text-red-700">
                    {save.error instanceof ApiError ? save.error.message : 'Save failed'}
                  </span>
                )}
                {save.isSuccess && !dirty && <span className="ml-3 text-emerald-700">Saved</span>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!dirty}
                  onClick={() => setForm(initialForm(data))}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40"
                >
                  Discard
                </button>
                <button
                  type="submit"
                  disabled={!dirty || save.isPending}
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
        )}
      </main>
    </>
  );
}

// ------------------------- Sections ------------------------

interface SectionProps {
  data: ApplianceSettings;
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function SourceBadge({ source }: { source: ApplianceSettingsSource }) {
  const label = source === 'db' ? 'stored' : source === 'env' ? 'env fallback' : 'not set';
  const tone =
    source === 'db'
      ? 'bg-emerald-50 text-emerald-800'
      : source === 'env'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${tone}`}>
      {label}
    </span>
  );
}

function Field({
  label,
  hint,
  source,
  children,
}: {
  label: string;
  hint?: string;
  source?: ApplianceSettingsSource;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
        {label}
        {source && <SourceBadge source={source} />}
      </span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
      {children}
    </label>
  );
}

function textInputClass(): string {
  return 'rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-slate-500 focus:outline-none';
}

function EmailItSection({ data, form, setForm }: SectionProps) {
  return (
    <Card
      title="Email (EmailIt)"
      description="Appliance-wide fallback for companies that haven't configured their own EmailIt key. A company's own settings always take precedence."
    >
      <SecretField
        label="API key"
        source={data.emailit.apiKeySource}
        hasSecret={data.emailit.apiKeyHasSecret}
        state={form.emailit.apiKey}
        onChange={(apiKey) => setForm((f) => f && { ...f, emailit: { ...f.emailit, apiKey } })}
      />
      <Field
        label="From email"
        source={data.emailit.fromEmailSource}
        hint="Shown as the sender on every outbound email."
      >
        <input
          type="email"
          className={textInputClass()}
          placeholder={data.emailit.fromEmailSource === 'env' ? '(from env)' : 'ops@yourfirm.com'}
          value={form.emailit.fromEmail ?? ''}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  emailit: {
                    ...f.emailit,
                    fromEmail: e.target.value,
                    fromEmailDirty: true,
                  },
                },
            )
          }
        />
      </Field>
      <Field label="From name" source={data.emailit.fromNameSource}>
        <input
          className={textInputClass()}
          value={form.emailit.fromName ?? ''}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  emailit: {
                    ...f.emailit,
                    fromName: e.target.value,
                    fromNameDirty: true,
                  },
                },
            )
          }
        />
      </Field>
      <Field
        label="API base URL"
        source={data.emailit.apiBaseUrlSource}
        hint="Override only if EmailIt publishes a different endpoint."
      >
        <input
          className={textInputClass()}
          placeholder="https://api.emailit.com/v2"
          value={form.emailit.apiBaseUrl ?? ''}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  emailit: {
                    ...f.emailit,
                    apiBaseUrl: e.target.value,
                    apiBaseUrlDirty: true,
                  },
                },
            )
          }
        />
      </Field>
      <TestEmailWidget disabled={!data.emailit.apiKeyHasSecret || !data.emailit.fromEmail} />
    </Card>
  );
}

function TestEmailWidget({ disabled }: { disabled: boolean }) {
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () => admin.testEmail({ to: to.trim() }),
  });
  const result = send.data ?? null;
  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-end gap-2">
        <Field
          label="Test recipient"
          source="db"
          hint="Uses the appliance-level EmailIt credentials above."
        >
          <input
            type="email"
            className={textInputClass()}
            placeholder="you@yourfirm.com"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={disabled || !to.trim() || send.isPending}
          className="mb-0.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-100 disabled:opacity-50"
        >
          {send.isPending ? 'Sending…' : 'Send test email'}
        </button>
      </div>
      <TestResultBanner result={result} disabled={disabled} />
    </div>
  );
}

function TestResultBanner({
  result,
  disabled,
}: {
  result: {
    ok: boolean;
    error: string | null;
    provider: string | null;
    providerMessageId: string | null;
  } | null;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <p className="mt-2 text-xs text-slate-500">
        Configure credentials above (and save) before sending a test.
      </p>
    );
  }
  if (!result) return null;
  if (result.ok) {
    return (
      <p className="mt-2 rounded bg-emerald-100 px-2 py-1 text-xs text-emerald-900">
        Sent via {result.provider ?? 'provider'}
        {result.providerMessageId ? ` · ${result.providerMessageId}` : ''}
      </p>
    );
  }
  return (
    <p className="mt-2 rounded bg-red-100 px-2 py-1 text-xs text-red-800">
      Failed: {result.error ?? 'unknown error'}
    </p>
  );
}

function SmsSection({ data, form, setForm }: SectionProps) {
  // Which provider's credential fields to render. Defaults to whatever
  // the appliance has picked, or 'twilio' if nothing picked yet so the
  // form isn't blank when an operator first visits.
  const activeProvider = form.sms.provider ?? 'twilio';

  return (
    <Card
      title="SMS"
      description="Appliance-wide fallback for per-company SMS. Pick a provider; companies that don't override it inherit this one. Feature-complete regardless of provider — the magic-link text, missed-punch SMS, and verification codes all route through whichever provider you choose."
    >
      <Field label="Provider">
        <div className="flex gap-2">
          {(['twilio', 'textlinksms'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                setForm(
                  (f) =>
                    f && {
                      ...f,
                      sms: { ...f.sms, provider: p, providerDirty: true },
                    },
                )
              }
              className={
                'rounded-md border px-3 py-1.5 text-sm ' +
                (activeProvider === p
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
              }
            >
              {p === 'twilio' ? 'Twilio' : 'TextLinkSMS'}
            </button>
          ))}
          {form.sms.provider !== null && (
            <button
              type="button"
              onClick={() =>
                setForm(
                  (f) =>
                    f && {
                      ...f,
                      sms: { ...f.sms, provider: null, providerDirty: true },
                    },
                )
              }
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              None
            </button>
          )}
        </div>
      </Field>

      {activeProvider === 'twilio' ? (
        <>
          <Field label="Account SID">
            <input
              className={textInputClass()}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              value={form.sms.twilioAccountSid ?? ''}
              onChange={(e) =>
                setForm(
                  (f) =>
                    f && {
                      ...f,
                      sms: {
                        ...f.sms,
                        twilioAccountSid: e.target.value,
                        twilioAccountSidDirty: true,
                      },
                    },
                )
              }
            />
          </Field>
          <SecretField
            label="Auth token"
            source={data.sms.twilio.authTokenHasSecret ? 'db' : 'unset'}
            hasSecret={data.sms.twilio.authTokenHasSecret}
            state={form.sms.twilioAuthToken}
            onChange={(twilioAuthToken) =>
              setForm((f) => f && { ...f, sms: { ...f.sms, twilioAuthToken } })
            }
          />
          <Field label="From number" hint="E.164 format, e.g. +15551234567">
            <input
              className={textInputClass()}
              placeholder="+15551234567"
              value={form.sms.twilioFromNumber ?? ''}
              onChange={(e) =>
                setForm(
                  (f) =>
                    f && {
                      ...f,
                      sms: {
                        ...f.sms,
                        twilioFromNumber: e.target.value,
                        twilioFromNumberDirty: true,
                      },
                    },
                )
              }
            />
          </Field>
        </>
      ) : (
        <>
          <SecretField
            label="API key"
            source={data.sms.textlinksms.apiKeyHasSecret ? 'db' : 'unset'}
            hasSecret={data.sms.textlinksms.apiKeyHasSecret}
            state={form.sms.textlinkApiKey}
            onChange={(textlinkApiKey) =>
              setForm((f) => f && { ...f, sms: { ...f.sms, textlinkApiKey } })
            }
          />
          <Field label="From number" hint="The sender ID TextLinkSMS provisioned for your account">
            <input
              className={textInputClass()}
              placeholder="+15551234567"
              value={form.sms.textlinkFromNumber ?? ''}
              onChange={(e) =>
                setForm(
                  (f) =>
                    f && {
                      ...f,
                      sms: {
                        ...f.sms,
                        textlinkFromNumber: e.target.value,
                        textlinkFromNumberDirty: true,
                      },
                    },
                )
              }
            />
          </Field>
          <Field
            label="API base URL"
            hint="Leave blank for the default (https://textlinksms.com). Override only for a self-hosted fork."
          >
            <input
              className={textInputClass()}
              placeholder="https://textlinksms.com"
              value={form.sms.textlinkBaseUrl ?? ''}
              onChange={(e) =>
                setForm(
                  (f) =>
                    f && {
                      ...f,
                      sms: {
                        ...f.sms,
                        textlinkBaseUrl: e.target.value,
                        textlinkBaseUrlDirty: true,
                      },
                    },
                )
              }
            />
          </Field>
        </>
      )}
      <TestSmsWidget data={data} />
    </Card>
  );
}

function TestSmsWidget({ data }: { data: ApplianceSettings }) {
  const [to, setTo] = useState('');
  const send = useMutation({
    mutationFn: () => admin.testSms({ to: to.trim() }),
  });
  const provider = data.sms.provider;
  const hasCreds =
    (provider === 'twilio' &&
      !!data.sms.twilio.accountSid &&
      data.sms.twilio.authTokenHasSecret &&
      !!data.sms.twilio.fromNumber) ||
    (provider === 'textlinksms' &&
      data.sms.textlinksms.apiKeyHasSecret &&
      !!data.sms.textlinksms.fromNumber);
  const disabled = !provider || !hasCreds;
  const result = send.data ?? null;

  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-end gap-2">
        <Field
          label="Test recipient"
          source="db"
          hint="Uses the appliance-level SMS credentials above. E.164 format."
        >
          <input
            type="tel"
            className={textInputClass()}
            placeholder="+15555550123"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={disabled || !to.trim() || send.isPending}
          className="mb-0.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium shadow-sm hover:bg-slate-100 disabled:opacity-50"
        >
          {send.isPending ? 'Sending…' : 'Send test SMS'}
        </button>
      </div>
      <TestResultBanner result={result} disabled={disabled} />
    </div>
  );
}

function AISection({ data, form, setForm }: SectionProps) {
  return (
    <Card
      title="AI"
      description="Appliance-wide fallback for NL corrections and support chat. Companies can override per-company."
    >
      <Field label="Provider" source={data.ai.providerSource}>
        <select
          className={textInputClass()}
          value={form.ai.provider}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  ai: {
                    ...f.ai,
                    provider: e.target.value as ApplianceSettings['ai']['provider'],
                    providerDirty: true,
                  },
                },
            )
          }
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai_compatible">OpenAI-compatible</option>
          <option value="ollama">Ollama (self-hosted)</option>
        </select>
      </Field>
      <SecretField
        label="API key"
        source={data.ai.apiKeySource}
        hasSecret={data.ai.apiKeyHasSecret}
        state={form.ai.apiKey}
        onChange={(apiKey) => setForm((f) => f && { ...f, ai: { ...f.ai, apiKey } })}
      />
      <Field
        label="Model"
        source={data.ai.modelSource}
        hint="Leave blank to use the provider's default."
      >
        <input
          className={textInputClass()}
          placeholder={data.ai.provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini'}
          value={form.ai.model ?? ''}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  ai: { ...f.ai, model: e.target.value, modelDirty: true },
                },
            )
          }
        />
      </Field>
      <Field
        label="Base URL"
        source={data.ai.baseUrlSource}
        hint="Only relevant for OpenAI-compatible endpoints or a local Ollama."
      >
        <input
          className={textInputClass()}
          placeholder="https://…"
          value={form.ai.baseUrl ?? ''}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  ai: { ...f.ai, baseUrl: e.target.value, baseUrlDirty: true },
                },
            )
          }
        />
      </Field>
    </Card>
  );
}

function RetentionSection({ data, form, setForm }: SectionProps) {
  return (
    <Card
      title="Backup retention"
      description="How many days of nightly pg_dump backups to keep on disk."
    >
      <Field
        label="Days"
        source={data.retentionDaysSource}
        hint="1–3650. Older dumps are pruned nightly."
      >
        <input
          type="number"
          min={1}
          max={3650}
          className={textInputClass()}
          value={form.retentionDays}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  retentionDays: Math.max(1, Math.min(3650, Number(e.target.value) || 1)),
                  retentionDaysDirty: true,
                },
            )
          }
        />
      </Field>
    </Card>
  );
}

function LogLevelSection({ data, form, setForm }: SectionProps) {
  return (
    <Card
      title="Log level"
      description="Applies live to the running backend — no restart. Increase when debugging, return to 'info' after."
    >
      <Field label="Level" source={data.logLevelSource}>
        <select
          className={textInputClass()}
          value={form.logLevel}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  logLevel: e.target.value as ApplianceSettings['logLevel'],
                  logLevelDirty: true,
                },
            )
          }
        >
          <option value="trace">trace (firehose)</option>
          <option value="debug">debug</option>
          <option value="info">info (default)</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="fatal">fatal</option>
          <option value="silent">silent</option>
        </select>
      </Field>
    </Card>
  );
}

// ---------------------- Secret field ----------------------

function SecretField({
  label,
  source,
  hasSecret,
  state,
  onChange,
}: {
  label: string;
  source: ApplianceSettingsSource;
  hasSecret: boolean;
  state: SecretState;
  onChange: (next: SecretState) => void;
}) {
  return (
    <Field label={label} source={source}>
      {state.mode === 'unchanged' ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600">{hasSecret ? 'Configured' : 'Not set'}</span>
          <button
            type="button"
            onClick={() => onChange({ mode: 'new', value: '' })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm hover:bg-slate-50"
          >
            {hasSecret ? 'Change' : 'Set'}
          </button>
          {hasSecret && source === 'db' && (
            <button
              type="button"
              onClick={() => onChange({ mode: 'clear' })}
              className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 shadow-sm hover:bg-red-50"
            >
              Clear
            </button>
          )}
        </div>
      ) : state.mode === 'new' ? (
        <div className="flex items-center gap-2">
          <input
            type="password"
            autoComplete="new-password"
            className={textInputClass() + ' flex-1'}
            value={state.value}
            onChange={(e) => onChange({ mode: 'new', value: e.target.value })}
            placeholder="Paste new key"
          />
          <button
            type="button"
            onClick={() => onChange({ mode: 'unchanged' })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-red-700">Will clear on save</span>
          <button
            type="button"
            onClick={() => onChange({ mode: 'unchanged' })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs shadow-sm hover:bg-slate-50"
          >
            Undo
          </button>
        </div>
      )}
    </Field>
  );
}

// ---------------------- Branding section ----------------------

function BrandingSection({
  form,
  setForm,
}: {
  form: FormState;
  setForm: (fn: (f: FormState | null) => FormState | null) => void;
}) {
  return (
    <Card
      title="Brand name"
      description="Shown in the top-left of every page and on the login screen. Leave blank to use the product default."
    >
      <Field
        label="Display name"
        source={form.displayName ? 'db' : 'unset'}
        hint="Up to 80 characters."
      >
        <input
          className={textInputClass()}
          placeholder="Vibe Payroll Time"
          maxLength={80}
          value={form.displayName ?? ''}
          onChange={(e) =>
            setForm(
              (f) =>
                f && {
                  ...f,
                  displayName: e.target.value || null,
                  displayNameDirty: true,
                },
            )
          }
        />
      </Field>
    </Card>
  );
}

// ---------------------- Demo-seed section ----------------------

function DemoSeedSection() {
  const run = useMutation({
    mutationFn: () => admin.seedDemo(),
  });
  return (
    <Card
      title="Demo company"
      description="Load or reload the Acme Plumbing demo (6 employees, 3 jobs, ~14 days of entries) — idempotent. Useful for showing the app to someone before real people are onboarded. Never touches users or your firm company."
    >
      <div className="flex flex-col gap-2">
        <div>
          <Button
            onClick={() => {
              if (
                run.data ||
                window.confirm(
                  'Reload the Acme Plumbing demo? Existing demo data will be wiped and recreated.',
                )
              ) {
                run.mutate();
              }
            }}
            loading={run.isPending}
          >
            {run.data ? 'Reload demo' : 'Seed demo company'}
          </Button>
        </div>
        {run.data && !run.isPending && (
          <p className="text-xs text-emerald-700">
            Demo company created. Seed PINs: Alice 100623 · Bob 204816 · Carol 307291 · David 401375
            · Eva 508264 · Frank 603571.
          </p>
        )}
        {run.error && (
          <p className="text-xs text-red-700">
            {run.error instanceof ApiError ? run.error.message : 'Seed failed.'}
          </p>
        )}
      </div>
    </Card>
  );
}

// ---------------------- Cloudflare Tunnel section ----------------------

function TunnelSection() {
  const qc = useQueryClient();
  const { data, error, isLoading } = useQuery({
    queryKey: ['admin-tunnel'],
    queryFn: admin.tunnel,
    // Poll while an apply is in progress so the UI sees the terminal
    // state without the operator refreshing.
    refetchInterval: (q) => {
      const s = q.state.data?.applyState;
      return s === 'queued' || s === 'running' ? 2000 : false;
    },
  });

  const [tokenDraft, setTokenDraft] = useState('');
  const [showToken, setShowToken] = useState(false);

  const patchMut = useMutation({
    mutationFn: (body: UpdateTunnelRequest) => admin.updateTunnel(body),
    onSuccess: (next) => {
      qc.setQueryData(['admin-tunnel'], next);
      setTokenDraft('');
    },
  });

  const busy =
    patchMut.isPending || data?.applyState === 'queued' || data?.applyState === 'running';

  return (
    <Card
      title="Cloudflare Tunnel"
      description="Toggle the cloudflared sidecar and set or rotate its token without SSH. Applies by editing .env and restarting the cloudflare compose profile."
    >
      {isLoading && <p className="text-sm text-slate-500">Loading tunnel status…</p>}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error instanceof ApiError ? error.message : 'Failed to load tunnel status.'}
        </p>
      )}
      {data && data.devMode && (
        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <b>Dev mode.</b> The backend writes request files but no host-side systemd unit is
          watching — tunnel changes won't actually restart any container here. Test this flow on a
          real appliance install.
        </p>
      )}
      {data && !data.devMode && !data.updaterWired && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          The host-side systemd units (<code>vibept-tunnel.path</code> /{' '}
          <code>vibept-tunnel.service</code>) aren't installed. Re-run{' '}
          <code>scripts/appliance/install.sh</code> to wire them up — until then the toggle below
          will return a 503.
        </p>
      )}
      {data && (
        <div className="flex flex-col gap-4">
          <ApplyStateBanner state={data.applyState} lastError={data.lastError} />
          <Field
            label="Tunnel sidecar"
            source="db"
            hint="Enable runs cloudflared alongside the backend; disable stops the sidecar only (the rest of the stack keeps running)."
          >
            <label className="inline-flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={data.enabled}
                onChange={(e) => patchMut.mutate({ enabled: e.target.checked })}
                disabled={busy || !data.updaterWired}
                className="h-4 w-4"
              />
              <span className="text-sm">
                {data.enabled ? (
                  <span className="text-emerald-700">Enabled</span>
                ) : (
                  <span className="text-slate-500">Disabled</span>
                )}
              </span>
            </label>
          </Field>

          <Field
            label="Tunnel token"
            source={data.hasToken ? 'db' : 'unset'}
            hint="Create or refresh the tunnel at one.dash.cloudflare.com → Networks → Tunnels → Overview. Paste the token once — we never echo it back."
          >
            <div className="flex flex-col gap-2">
              <div className="text-xs text-slate-500">
                Status:{' '}
                {data.hasToken ? (
                  <span className="text-emerald-700">Configured</span>
                ) : (
                  <span className="text-slate-500">Not set</span>
                )}
                {data.lastAppliedAt && (
                  <>
                    {' · Last applied '}
                    {new Date(data.lastAppliedAt).toLocaleString()}
                  </>
                )}
              </div>
              <div className="flex items-stretch gap-2">
                <input
                  type={showToken ? 'text' : 'password'}
                  className={textInputClass() + ' font-mono'}
                  placeholder="eyJhIjoi… (paste from Cloudflare)"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  disabled={busy || !data.updaterWired}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="rounded-md border border-slate-300 bg-white px-2 text-xs hover:bg-slate-100"
                >
                  {showToken ? 'Hide' : 'Show'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => patchMut.mutate({ token: tokenDraft.trim() })}
                  disabled={busy || !data.updaterWired || tokenDraft.trim().length < 20}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
                >
                  {data.hasToken ? 'Rotate token' : 'Save token'}
                </button>
                {data.hasToken && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(
                          'Clear the tunnel token? This will also disable the sidecar (cloudflared fails immediately without a token).',
                        )
                      ) {
                        patchMut.mutate({ token: null });
                      }
                    }}
                    disabled={busy || !data.updaterWired}
                    className="rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Clear token
                  </button>
                )}
              </div>
              {patchMut.error && (
                <p className="text-xs text-red-700">
                  {patchMut.error instanceof ApiError
                    ? patchMut.error.message
                    : 'Tunnel update failed.'}
                </p>
              )}
            </div>
          </Field>

          <p className="text-xs text-slate-500">
            Route mapping (hostname → <code>caddy:8080</code>) still happens at{' '}
            <a
              className="underline hover:text-slate-900"
              href="https://one.dash.cloudflare.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              one.dash.cloudflare.com
            </a>
            . This page only controls whether the sidecar runs and which token it uses.
          </p>
        </div>
      )}
    </Card>
  );
}

function ApplyStateBanner({
  state,
  lastError,
}: {
  state: TunnelStatusResponse['applyState'];
  lastError: string | null;
}) {
  if (state === 'queued' || state === 'running') {
    return (
      <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
        {state === 'queued' ? 'Waiting for host to pick up the request…' : 'Applying on host…'}
      </div>
    );
  }
  if (state === 'failed' && lastError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
        Last apply failed: {lastError}
      </div>
    );
  }
  return null;
}

// ---------------------- License section ----------------------

function LicenseSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['admin-license'],
    queryFn: admin.licenseStatus,
  });

  const [jwtText, setJwtText] = useState('');
  const [mode, setMode] = useState<'idle' | 'paste'>('idle');

  const upload = useMutation({
    mutationFn: (jwt: string) => admin.uploadLicense(jwt),
    onSuccess: (next) => {
      qc.setQueryData(['admin-license'], next);
      setJwtText('');
      setMode('idle');
    },
  });

  const clear = useMutation({
    mutationFn: admin.clearLicense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-license'] });
    },
  });

  if (!data) {
    return (
      <Card title="License">
        <p className="text-sm text-slate-500">Loading…</p>
      </Card>
    );
  }

  const s = data;
  const stateTone: Record<typeof s.state, string> = {
    internal_free: 'bg-emerald-100 text-emerald-800',
    licensed: 'bg-emerald-100 text-emerald-800',
    trial: 'bg-amber-100 text-amber-800',
    grace: 'bg-amber-100 text-amber-900',
    expired: 'bg-red-100 text-red-800',
  };

  const hasUploaded = s.claims != null;

  return (
    <Card
      title="License"
      description="One license covers every non-internal company on this appliance. Internal firm-use companies always bypass enforcement."
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-slate-500">State</p>
          <p className="mt-1">
            <span className={'rounded-full px-3 py-1 text-xs font-medium ' + stateTone[s.state]}>
              {s.state.replace('_', ' ')}
            </span>
          </p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <p>
            Enforcement:{' '}
            <span className="font-medium text-slate-900">
              {s.enforced ? 'ON' : 'off (pre-live)'}
            </span>
          </p>
          {s.expiresAt && (
            <p className="mt-1">
              Expires {new Date(s.expiresAt).toLocaleDateString()}
              {typeof s.daysUntilExpiry === 'number' && (
                <span className="ml-1 text-slate-500">({s.daysUntilExpiry} days)</span>
              )}
            </p>
          )}
          {s.lastCheckedAt && (
            <p className="mt-1">Last portal check {new Date(s.lastCheckedAt).toLocaleString()}</p>
          )}
        </div>
      </div>

      {s.claims && (
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="mb-2 font-semibold uppercase text-slate-600">Claims</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-slate-500">Issuer</dt>
            <dd className="text-slate-800">{s.claims.iss}</dd>
            <dt className="text-slate-500">Appliance</dt>
            <dd className="font-mono text-slate-800">{s.claims.appliance_id}</dd>
            <dt className="text-slate-500">Tier</dt>
            <dd className="text-slate-800">{s.claims.tier.replace(/_/g, ' ')}</dd>
            {s.claims.employee_count_cap != null && (
              <>
                <dt className="text-slate-500">Seat cap</dt>
                <dd className="text-slate-800">{s.claims.employee_count_cap}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        {mode === 'idle' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('paste')}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50"
            >
              {hasUploaded ? 'Replace license' : 'Upload license'}
            </button>
            {hasUploaded && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Clear the stored license and revert to trial?')) clear.mutate();
                }}
                disabled={clear.isPending}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 shadow-sm hover:bg-red-50 disabled:opacity-60"
              >
                Clear license
              </button>
            )}
            <p className="ml-auto text-xs text-slate-500">
              Buy / renew at{' '}
              <a
                href="https://licensing.kisaes.com"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                licensing.kisaes.com
              </a>
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500">
              Paste the full JWT from the portal, including the two dots. The server verifies the
              RS256 signature before saving.
            </p>
            <textarea
              className="h-32 w-full rounded-md border border-slate-300 bg-white p-2 font-mono text-xs shadow-sm"
              placeholder="eyJ..."
              value={jwtText}
              onChange={(e) => setJwtText(e.target.value)}
            />
            {upload.isError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                {upload.error instanceof ApiError
                  ? `${upload.error.code}: ${upload.error.message}`
                  : 'Upload failed.'}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setMode('idle');
                  setJwtText('');
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!jwtText.trim() || upload.isPending}
                onClick={() => upload.mutate(jwtText.trim())}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {upload.isPending ? 'Verifying…' : 'Upload'}
              </button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
