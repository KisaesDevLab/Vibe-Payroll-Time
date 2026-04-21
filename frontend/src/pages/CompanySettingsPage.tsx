import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AISettings,
  Company,
  CompanySettings,
  UpdateAISettingsRequest,
  UpdateCompanyRequest,
  UpdateCompanySettingsRequest,
} from '@vibept/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Button } from '../components/Button';
import { FormField } from '../components/FormField';
import { Modal } from '../components/Modal';
import { ApiError } from '../lib/api';
import { ai, companies as companiesApi, companySettings as settingsApi } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

type Section = 'general' | 'punch' | 'approval' | 'notifications' | 'ai';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'punch', label: 'Punch rules' },
  { id: 'approval', label: 'Approval' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'ai', label: 'AI' },
];

export function CompanySettingsPage() {
  const { companyId } = useOutletContext<CompanyContext>();
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>('general');
  const [confirmPayPeriodChange, setConfirmPayPeriodChange] = useState<
    UpdateCompanyRequest['payPeriodType'] | null
  >(null);

  const companyQ = useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companiesApi.get(companyId),
  });
  const settingsQ = useQuery({
    queryKey: ['settings', companyId],
    queryFn: () => settingsApi.get(companyId),
  });

  const updateCompany = useMutation({
    mutationFn: (body: UpdateCompanyRequest) => companiesApi.update(companyId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['company', companyId] }),
  });

  const updateSettings = useMutation({
    mutationFn: (body: UpdateCompanySettingsRequest) => settingsApi.update(companyId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', companyId] }),
  });

  if (!companyQ.data || !settingsQ.data) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <nav className="flex shrink-0 gap-1 overflow-x-auto md:w-48 md:flex-col">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={
              'rounded-md px-3 py-2 text-left text-sm font-medium transition ' +
              (section === s.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')
            }
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="flex-1 space-y-6">
        {section === 'general' && (
          <GeneralSection
            company={companyQ.data}
            onSubmit={(body) => {
              if (body.payPeriodType && body.payPeriodType !== companyQ.data!.payPeriodType) {
                setConfirmPayPeriodChange(body.payPeriodType);
                return;
              }
              updateCompany.mutate(body);
            }}
            saving={updateCompany.isPending}
            error={updateCompany.error}
          />
        )}
        {section === 'punch' && (
          <PunchSection
            settings={settingsQ.data}
            onSubmit={updateSettings.mutate}
            saving={updateSettings.isPending}
            error={updateSettings.error}
          />
        )}
        {section === 'approval' && (
          <ApprovalSection
            settings={settingsQ.data}
            onSubmit={updateSettings.mutate}
            saving={updateSettings.isPending}
            error={updateSettings.error}
          />
        )}
        {section === 'notifications' && (
          <NotificationsSection
            settings={settingsQ.data}
            onSubmit={updateSettings.mutate}
            saving={updateSettings.isPending}
            error={updateSettings.error}
          />
        )}
        {section === 'ai' && <AISection companyId={companyId} />}
      </div>

      {confirmPayPeriodChange && (
        <Modal
          open
          onClose={() => setConfirmPayPeriodChange(null)}
          title="Change pay period type?"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmPayPeriodChange(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  updateCompany.mutate({ payPeriodType: confirmPayPeriodChange });
                  setConfirmPayPeriodChange(null);
                }}
              >
                Change
              </Button>
            </div>
          }
        >
          <p className="text-sm text-slate-700">
            Changing the pay period type affects every future timesheet and report aggregation.
            Existing approved pay periods are untouched. Proceed?
          </p>
        </Modal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function GeneralSection({
  company,
  onSubmit,
  saving,
  error,
}: {
  company: Company;
  onSubmit: (body: UpdateCompanyRequest) => void;
  saving: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState<UpdateCompanyRequest>({});
  const effective = useMemo(() => ({ ...company, ...form }), [company, form]);

  return (
    <SectionShell
      title="General"
      onSave={() => onSubmit(form)}
      saving={saving}
      error={error}
      disabled={Object.keys(form).length === 0}
    >
      <FormField
        label="Name"
        defaultValue={company.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />
      <FormField
        label="Slug"
        defaultValue={company.slug}
        onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
      />
      <FormField
        label="Timezone"
        defaultValue={company.timezone}
        onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
      />
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Week starts on</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
            defaultValue={company.weekStartDay}
            onChange={(e) => setForm((f) => ({ ...f, weekStartDay: Number(e.target.value) }))}
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
            value={effective.payPeriodType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                payPeriodType: e.target.value as UpdateCompanyRequest['payPeriodType'],
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
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// Punch rules
// ---------------------------------------------------------------------------

function PunchSection({
  settings,
  onSubmit,
  saving,
  error,
}: {
  settings: CompanySettings;
  onSubmit: (body: UpdateCompanySettingsRequest) => void;
  saving: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState<UpdateCompanySettingsRequest>({});

  return (
    <SectionShell
      title="Punch rules"
      onSave={() => onSubmit(form)}
      saving={saving}
      error={error}
      disabled={Object.keys(form).length === 0}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Rounding</span>
        <select
          className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
          defaultValue={settings.punchRoundingMode}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              punchRoundingMode: e.target.value as CompanySettings['punchRoundingMode'],
            }))
          }
        >
          <option value="none">None</option>
          <option value="1min">1 minute</option>
          <option value="5min">5 minutes</option>
          <option value="6min">6 minutes (tenths)</option>
          <option value="15min">15 minutes</option>
        </select>
      </label>
      <FormField
        label="Rounding grace (minutes)"
        type="number"
        min={0}
        max={15}
        defaultValue={settings.punchRoundingGraceMinutes}
        onChange={(e) =>
          setForm((f) => ({
            ...f,
            punchRoundingGraceMinutes: Number(e.target.value),
          }))
        }
      />
      <FormField
        label="Auto-clockout (hours)"
        type="number"
        min={4}
        max={24}
        defaultValue={settings.autoClockoutHours}
        onChange={(e) => setForm((f) => ({ ...f, autoClockoutHours: Number(e.target.value) }))}
        hint="Closes entries left open this long. Flags them for admin review."
      />
      <FormField
        label="Missed-punch reminder after (hours)"
        type="number"
        min={1}
        max={48}
        defaultValue={settings.missedPunchReminderHours}
        onChange={(e) =>
          setForm((f) => ({ ...f, missedPunchReminderHours: Number(e.target.value) }))
        }
      />
      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-2 text-xs font-medium uppercase text-slate-500">Auth surfaces</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            defaultChecked={settings.kioskEnabled}
            onChange={(e) => setForm((f) => ({ ...f, kioskEnabled: e.target.checked }))}
          />
          Kiosk mode enabled
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            defaultChecked={settings.personalDeviceEnabled}
            onChange={(e) => setForm((f) => ({ ...f, personalDeviceEnabled: e.target.checked }))}
          />
          Personal devices (PWA) enabled
        </label>
      </fieldset>
      <fieldset className="rounded-md border border-slate-200 p-4">
        <legend className="px-2 text-xs font-medium uppercase text-slate-500">
          Kiosk authentication
        </legend>
        <p className="mb-3 text-xs text-slate-500">
          How employees identify themselves at the tablet. QR badges are more forgery-resistant than
          a short PIN and faster at a shift change.
        </p>
        {(['pin', 'qr', 'both'] as const).map((mode) => (
          <label key={mode} className="mt-2 flex items-start gap-3 text-sm text-slate-700">
            <input
              type="radio"
              className="mt-1 h-4 w-4"
              name="kioskAuthMode"
              value={mode}
              defaultChecked={settings.kioskAuthMode === mode}
              onChange={() => setForm((f) => ({ ...f, kioskAuthMode: mode }))}
            />
            <span>
              <strong>
                {mode === 'pin' && 'PIN only'}
                {mode === 'qr' && 'QR badge only'}
                {mode === 'both' && 'Both'}
              </strong>
              <span className="ml-2 text-xs text-slate-500">
                {mode === 'pin' && '4–6 digit keypad at the tablet.'}
                {mode === 'qr' &&
                  'Camera scanner, printed badge. Falls back to PIN only if the camera is unavailable.'}
                {mode === 'both' &&
                  'Scanner and keypad both visible; employees pick whichever is faster.'}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

function ApprovalSection({
  settings,
  onSubmit,
  saving,
  error,
}: {
  settings: CompanySettings;
  onSubmit: (body: UpdateCompanySettingsRequest) => void;
  saving: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState<UpdateCompanySettingsRequest>({});

  return (
    <SectionShell
      title="Approval"
      onSave={() => onSubmit(form)}
      saving={saving}
      error={error}
      disabled={Object.keys(form).length === 0}
    >
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          defaultChecked={settings.supervisorApprovalRequired}
          onChange={(e) => setForm((f) => ({ ...f, supervisorApprovalRequired: e.target.checked }))}
        />
        Supervisor approval required before pay period close
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          defaultChecked={settings.allowSelfApprove}
          onChange={(e) => setForm((f) => ({ ...f, allowSelfApprove: e.target.checked }))}
        />
        Allow company admin to self-approve (solo firm / internal use)
      </label>
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function NotificationsSection({
  settings,
  onSubmit,
  saving,
  error,
}: {
  settings: CompanySettings;
  onSubmit: (body: UpdateCompanySettingsRequest) => void;
  saving: boolean;
  error: unknown;
}) {
  const [form, setForm] = useState<UpdateCompanySettingsRequest>({});

  return (
    <SectionShell
      title="Notifications"
      onSave={() => onSubmit(form)}
      saving={saving}
      error={error}
      disabled={Object.keys(form).length === 0}
    >
      <h3 className="text-sm font-semibold text-slate-900">Twilio (SMS)</h3>
      <FormField
        label="Account SID"
        defaultValue={settings.twilioAccountSid ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, twilioAccountSid: e.target.value || null }))}
      />
      <FormField
        label="Auth token"
        type="password"
        hint={
          settings.twilioAuthTokenConfigured
            ? 'A token is currently stored. Leave blank to keep; enter a new value to replace.'
            : 'Not configured. Paste your Twilio auth token to enable SMS.'
        }
        placeholder={settings.twilioAuthTokenConfigured ? '••••••••' : 'paste auth token'}
        onChange={(e) => setForm((f) => ({ ...f, twilioAuthToken: e.target.value || null }))}
      />
      <FormField
        label="From number"
        defaultValue={settings.twilioFromNumber ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, twilioFromNumber: e.target.value || null }))}
      />

      <h3 className="mt-4 text-sm font-semibold text-slate-900">EmailIt (email)</h3>
      <p className="-mt-2 text-xs text-slate-500">
        Transactional email goes through EmailIt.com. Get an API key at{' '}
        <a href="https://emailit.com" target="_blank" rel="noreferrer" className="underline">
          emailit.com
        </a>
        , then paste below. Leave the key blank to use the appliance-wide fallback (if the
        administrator has configured one).
      </p>
      <FormField
        label="API key"
        type="password"
        hint={
          settings.emailitApiKeyConfigured
            ? 'A key is currently stored. Leave blank to keep; enter a new value to replace.'
            : 'Not configured. Paste your EmailIt API key to enable email.'
        }
        placeholder={settings.emailitApiKeyConfigured ? '••••••••' : 'paste API key'}
        onChange={(e) => setForm((f) => ({ ...f, emailitApiKey: e.target.value || null }))}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="From email"
          type="email"
          defaultValue={settings.emailitFromEmail ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, emailitFromEmail: e.target.value || null }))}
        />
        <FormField
          label="From name"
          defaultValue={settings.emailitFromName ?? ''}
          onChange={(e) => setForm((f) => ({ ...f, emailitFromName: e.target.value || null }))}
        />
      </div>
      <FormField
        label="Reply-to (optional)"
        type="email"
        defaultValue={settings.emailitReplyTo ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, emailitReplyTo: e.target.value || null }))}
      />
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

function AISection({ companyId }: { companyId: number }) {
  const qc = useQueryClient();
  const settingsQ = useQuery({
    queryKey: ['ai-settings', companyId],
    queryFn: () => ai.getSettings(companyId),
  });
  const [form, setForm] = useState<UpdateAISettingsRequest>({});
  const update = useMutation({
    mutationFn: () => ai.updateSettings(companyId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-settings', companyId] });
      setForm({});
    },
  });

  if (!settingsQ.data) return <p className="text-sm text-slate-500">Loading…</p>;

  const effective = { ...settingsQ.data, ...form } as AISettings & UpdateAISettingsRequest;

  return (
    <SectionShell
      title="AI features"
      onSave={() => update.mutate()}
      saving={update.isPending}
      error={update.error}
      disabled={Object.keys(form).length === 0}
    >
      <p className="-mt-2 text-xs text-slate-500">
        Enables natural-language timesheet corrections and the support chat. Disabled by default.
        Credentials are stored per-company; the appliance-wide env value is used as a fallback.
      </p>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={!!effective.aiEnabled}
          onChange={(e) => setForm((f) => ({ ...f, aiEnabled: e.target.checked }))}
        />
        AI enabled for this company
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Provider</span>
          <select
            className="rounded-md border border-slate-300 bg-white px-3 py-2 shadow-sm"
            value={effective.aiProvider ?? 'anthropic'}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                aiProvider: e.target.value as AISettings['aiProvider'],
              }))
            }
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </label>
        <FormField
          label="Model"
          defaultValue={settingsQ.data.aiModel ?? ''}
          placeholder="defaults to a sensible per-provider pick"
          onChange={(e) => setForm((f) => ({ ...f, aiModel: e.target.value || null }))}
        />
      </div>

      <FormField
        label="API key"
        type="password"
        hint={
          settingsQ.data.aiApiKeyConfigured
            ? 'A key is currently stored. Leave blank to keep; enter a new value to replace.'
            : 'Not configured. The appliance-wide AI_API_KEY env var is used as a fallback if present.'
        }
        placeholder={settingsQ.data.aiApiKeyConfigured ? '••••••••' : 'paste API key'}
        onChange={(e) => setForm((f) => ({ ...f, aiApiKey: e.target.value || null }))}
      />
      <FormField
        label="Base URL (optional)"
        defaultValue={settingsQ.data.aiBaseUrl ?? ''}
        hint="Required for OpenAI-compatible / Ollama endpoints. Leave blank for Anthropic."
        onChange={(e) => setForm((f) => ({ ...f, aiBaseUrl: e.target.value || null }))}
      />
      <FormField
        label="Daily NL correction limit (per employee)"
        type="number"
        min={0}
        max={500}
        defaultValue={settingsQ.data.aiDailyCorrectionLimit}
        onChange={(e) => setForm((f) => ({ ...f, aiDailyCorrectionLimit: Number(e.target.value) }))}
      />

      <p className="text-xs text-slate-500">
        Tool-calling (needed for NL corrections) currently works only on Anthropic.
        OpenAI-compatible and Ollama backends power the support chat only.
      </p>
    </SectionShell>
  );
}

// ---------------------------------------------------------------------------
// Shared section shell
// ---------------------------------------------------------------------------

function SectionShell({
  title,
  children,
  onSave,
  saving,
  error,
  disabled,
}: {
  title: string;
  children: ReactNode;
  onSave: () => void;
  saving: boolean;
  error: unknown;
  disabled: boolean;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-slate-900">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
      {error ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error instanceof ApiError ? error.message : 'Save failed.'}
        </div>
      ) : null}
      <div className="mt-6 flex justify-end">
        <Button loading={saving} disabled={disabled} onClick={onSave}>
          Save changes
        </Button>
      </div>
    </section>
  );
}
