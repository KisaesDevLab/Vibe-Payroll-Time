import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplianceSettings,
  ApplianceSettingsSource,
  UpdateApplianceSettingsRequest,
} from '@vibept/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
  emailit: {
    apiKey: SecretState;
    fromEmail: string | null;
    fromEmailDirty: boolean;
    fromName: string | null;
    fromNameDirty: boolean;
    apiBaseUrl: string | null;
    apiBaseUrlDirty: boolean;
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
    emailit: {
      apiKey: { mode: 'unchanged' },
      fromEmail: s.emailit.fromEmail,
      fromEmailDirty: false,
      fromName: s.emailit.fromName,
      fromNameDirty: false,
      apiBaseUrl: s.emailit.apiBaseUrl,
      apiBaseUrlDirty: false,
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

  if (f.retentionDaysDirty) patch.retentionDays = f.retentionDays;
  if (f.logLevelDirty) patch.logLevel = f.logLevel;

  return patch;
}

function isDirty(f: FormState): boolean {
  return (
    f.emailit.apiKey.mode !== 'unchanged' ||
    f.emailit.fromEmailDirty ||
    f.emailit.fromNameDirty ||
    f.emailit.apiBaseUrlDirty ||
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
            <EmailItSection data={data} form={form} setForm={setForm} />
            <AISection data={data} form={form} setForm={setForm} />
            <RetentionSection data={data} form={form} setForm={setForm} />
            <LogLevelSection data={data} form={form} setForm={setForm} />
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
          placeholder="https://api.emailit.com/v1"
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
    </Card>
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
