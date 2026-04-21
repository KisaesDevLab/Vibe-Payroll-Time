import type {
  ApprovePeriodRequest,
  ApprovePeriodResponse,
  BadgeEvent,
  BulkIssueBadgesRequest,
  Company,
  CompanySettings,
  CorrectionRequest,
  CreateCorrectionRequest,
  CreateEmployeeRequest,
  CreateEntryRequest,
  CreateJobRequest,
  CreateKioskPairingCodeRequest,
  CsvImportRequest,
  CsvImportResponse,
  DecideCorrectionRequest,
  EditEntryRequest,
  Employee,
  EmployeeBadgeState,
  EmployeeWithPinResponse,
  IssueBadgeResponse,
  EntryAuditRow,
  EmployeePreferences,
  InviteMembershipRequest,
  Job,
  KioskDevice,
  KioskPairingCodeResponse,
  LicenseStatus,
  Membership,
  AISettings,
  ChatRequest,
  ChatResponse,
  NLCorrectionApplyRequest,
  NLCorrectionApplyResult,
  NLCorrectionPreview,
  NLCorrectionRequest,
  NotificationsLogRow,
  PayrollExport,
  UpdateAISettingsRequest,
  PreflightRequest,
  PreflightResponse,
  ReportCatalogResponse,
  ReportResult,
  RunExportRequest,
  TimeEntry,
  TimesheetResponse,
  UpdateCompanyRequest,
  UpdateCompanySettingsRequest,
  UpdateEmployeePreferencesRequest,
  UpdateEmployeeRequest,
  ApplianceSettings,
  UpdateApplianceSettingsRequest,
  UpdateCheckResponse,
  UpdateJobRequest,
  UpdateLogResponse,
  UpdateRunResponse,
  UpdateStatusResponse,
} from '@vibept/shared';
import { apiFetch } from './api';
import { authStore } from './auth-store';

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

export const companies = {
  list: () => apiFetch<Company[]>('/companies'),
  get: (id: number) => apiFetch<Company>(`/companies/${id}`),
  update: (id: number, body: UpdateCompanyRequest) =>
    apiFetch<Company>(`/companies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

export const companySettings = {
  get: (companyId: number) => apiFetch<CompanySettings>(`/companies/${companyId}/settings`),
  update: (companyId: number, body: UpdateCompanySettingsRequest) =>
    apiFetch<CompanySettings>(`/companies/${companyId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export const memberships = {
  list: (companyId: number) => apiFetch<Membership[]>(`/companies/${companyId}/memberships`),
  invite: (companyId: number, body: InviteMembershipRequest) =>
    apiFetch<Membership>(`/companies/${companyId}/memberships`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateRole: (companyId: number, membershipId: number, role: Membership['role']) =>
    apiFetch<Membership>(`/companies/${companyId}/memberships/${membershipId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  revoke: (companyId: number, membershipId: number) =>
    apiFetch<void>(`/companies/${companyId}/memberships/${membershipId}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const employees = {
  list: (companyId: number, search?: string) => {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return apiFetch<Employee[]>(`/companies/${companyId}/employees${qs}`);
  },
  create: (companyId: number, body: CreateEmployeeRequest) =>
    apiFetch<EmployeeWithPinResponse>(`/companies/${companyId}/employees`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (companyId: number, employeeId: number, body: UpdateEmployeeRequest) =>
    apiFetch<Employee>(`/companies/${companyId}/employees/${employeeId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  regeneratePin: (companyId: number, employeeId: number, length = 6) =>
    apiFetch<EmployeeWithPinResponse>(
      `/companies/${companyId}/employees/${employeeId}/regenerate-pin`,
      {
        method: 'POST',
        body: JSON.stringify({ length }),
      },
    ),
  importCsv: (companyId: number, body: CsvImportRequest) =>
    apiFetch<CsvImportResponse>(`/companies/${companyId}/employees/import`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Badges — Phase 4.5 QR auth
// ---------------------------------------------------------------------------

export const badges = {
  getState: (companyId: number, employeeId: number) =>
    apiFetch<EmployeeBadgeState>(`/companies/${companyId}/employees/${employeeId}/badge`),
  issue: (companyId: number, employeeId: number) =>
    apiFetch<IssueBadgeResponse>(`/companies/${companyId}/employees/${employeeId}/badge/issue`, {
      method: 'POST',
    }),
  revoke: (companyId: number, employeeId: number, reason?: string) =>
    apiFetch<EmployeeBadgeState>(`/companies/${companyId}/employees/${employeeId}/badge/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  events: (companyId: number, employeeId: number) =>
    apiFetch<BadgeEvent[]>(`/companies/${companyId}/employees/${employeeId}/badge/events`),
  /** POSTs the employee ID list, receives the rendered HTML sheet, and
   *  opens it in a new tab via a Blob URL. The server issues the badges
   *  in one transaction so the sheet is always self-consistent. */
  bulkIssuePrint: async (
    companyId: number,
    body: BulkIssueBadgesRequest,
  ): Promise<{ issued: number; skipped: number }> => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
    const session = authStore.get();
    const res = await fetch(`${apiBase}/companies/${companyId}/employees/bulk-badges`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(session ? { authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = `Bulk badge issue failed (${res.status})`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch {
        /* not JSON — keep the default message */
      }
      throw new Error(message);
    }
    const issued = Number(res.headers.get('x-badges-issued') ?? '0');
    const skipped = Number(res.headers.get('x-badges-skipped') ?? '0');
    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    // Revoke after the new tab is done loading; generous window.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!win) throw new Error('Pop-up blocked — allow pop-ups to open the print sheet.');
    return { issued, skipped };
  },
};

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobs = {
  list: (companyId: number, includeArchived = false) => {
    const qs = includeArchived ? '?includeArchived=true' : '';
    return apiFetch<Job[]>(`/companies/${companyId}/jobs${qs}`);
  },
  create: (companyId: number, body: CreateJobRequest) =>
    apiFetch<Job>(`/companies/${companyId}/jobs`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (companyId: number, jobId: number, body: UpdateJobRequest) =>
    apiFetch<Job>(`/companies/${companyId}/jobs/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  archive: (companyId: number, jobId: number) =>
    apiFetch<void>(`/companies/${companyId}/jobs/${jobId}`, {
      method: 'DELETE',
    }),
  unarchive: (companyId: number, jobId: number) =>
    apiFetch<Job>(`/companies/${companyId}/jobs/${jobId}/unarchive`, {
      method: 'POST',
    }),
};

// ---------------------------------------------------------------------------
// Kiosk devices (admin side)
// ---------------------------------------------------------------------------

export const kiosks = {
  list: (companyId: number) => apiFetch<KioskDevice[]>(`/companies/${companyId}/kiosks`),
  issueCode: (companyId: number, body: CreateKioskPairingCodeRequest = {}) =>
    apiFetch<KioskPairingCodeResponse>(`/companies/${companyId}/kiosks/pairing-codes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  rename: (companyId: number, deviceId: number, name: string) =>
    apiFetch<KioskDevice>(`/companies/${companyId}/kiosks/${deviceId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  revoke: (companyId: number, deviceId: number) =>
    apiFetch<void>(`/companies/${companyId}/kiosks/${deviceId}`, {
      method: 'DELETE',
    }),
};

// ---------------------------------------------------------------------------
// Timesheets
// ---------------------------------------------------------------------------

export const timesheets = {
  get: (
    companyId: number,
    employeeId: number,
    opts: { periodStart?: string; periodEnd?: string } = {},
  ) => {
    const params = new URLSearchParams({
      companyId: String(companyId),
      employeeId: String(employeeId),
    });
    if (opts.periodStart) params.set('periodStart', opts.periodStart);
    if (opts.periodEnd) params.set('periodEnd', opts.periodEnd);
    return apiFetch<TimesheetResponse>(`/timesheets?${params.toString()}`);
  },
  current: (companyId: number) =>
    apiFetch<TimesheetResponse>(`/timesheets/current?companyId=${companyId}`),
  approve: (companyId: number, body: ApprovePeriodRequest) =>
    apiFetch<ApprovePeriodResponse>(`/timesheets/approve?companyId=${companyId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  unapprove: (companyId: number, body: ApprovePeriodRequest) =>
    apiFetch<{ unapprovedEntryCount: number }>(`/timesheets/unapprove?companyId=${companyId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  editEntry: (companyId: number, entryId: number, body: EditEntryRequest) =>
    apiFetch<TimeEntry>(`/timesheets/entries/${entryId}?companyId=${companyId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteEntry: (companyId: number, entryId: number, reason: string) =>
    apiFetch<void>(`/timesheets/entries/${entryId}?companyId=${companyId}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    }),
  createEntry: (companyId: number, body: CreateEntryRequest) =>
    apiFetch<TimeEntry>(`/timesheets/entries?companyId=${companyId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  audit: (companyId: number, entryId: number) =>
    apiFetch<EntryAuditRow[]>(`/timesheets/entries/${entryId}/audit?companyId=${companyId}`),
  createCorrection: (companyId: number, body: CreateCorrectionRequest) =>
    apiFetch<CorrectionRequest>(`/timesheets/correction-requests?companyId=${companyId}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

export const corrections = {
  list: (companyId: number, status?: 'pending' | 'approved' | 'rejected') => {
    const qs = status ? `?status=${status}` : '';
    return apiFetch<CorrectionRequest[]>(`/companies/${companyId}/correction-requests${qs}`);
  },
  approve: (companyId: number, id: number, body: DecideCorrectionRequest = {}) =>
    apiFetch<CorrectionRequest>(`/companies/${companyId}/correction-requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reject: (companyId: number, id: number, body: DecideCorrectionRequest = {}) =>
    apiFetch<CorrectionRequest>(`/companies/${companyId}/correction-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reports = {
  catalog: (companyId: number) =>
    apiFetch<ReportCatalogResponse>(`/companies/${companyId}/reports`),
  run: (companyId: number, name: string, params: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    return apiFetch<ReportResult>(`/companies/${companyId}/reports/${name}?${qs.toString()}`);
  },
  csvUrl: (
    companyId: number,
    name: string,
    params: Record<string, string | number | undefined>,
  ) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
    return `${apiBase}/companies/${companyId}/reports/${name}.csv?${qs.toString()}`;
  },
};

// ---------------------------------------------------------------------------
// Payroll exports
// ---------------------------------------------------------------------------

export const payrollExports = {
  preflight: (companyId: number, body: PreflightRequest) =>
    apiFetch<PreflightResponse>(`/companies/${companyId}/payroll-exports/preflight`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  run: (companyId: number, body: RunExportRequest) =>
    apiFetch<PayrollExport>(`/companies/${companyId}/payroll-exports`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  history: (companyId: number) =>
    apiFetch<PayrollExport[]>(`/companies/${companyId}/payroll-exports`),
  downloadUrl: (companyId: number, id: number) => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
    return `${apiBase}/companies/${companyId}/payroll-exports/${id}/download`;
  },
};

// ---------------------------------------------------------------------------
// Notifications (self-service + admin log)
// ---------------------------------------------------------------------------

export const notifications = {
  getPreferences: (companyId: number) =>
    apiFetch<EmployeePreferences>(`/notifications/preferences?companyId=${companyId}`),
  updatePreferences: (companyId: number, body: UpdateEmployeePreferencesRequest) =>
    apiFetch<EmployeePreferences>(`/notifications/preferences?companyId=${companyId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  requestPhoneVerification: (companyId: number, phone: string) =>
    apiFetch<{ expiresAt: string }>(
      `/notifications/phone-verification/request?companyId=${companyId}`,
      { method: 'POST', body: JSON.stringify({ phone }) },
    ),
  confirmPhoneVerification: (companyId: number, code: string) =>
    apiFetch<EmployeePreferences>(
      `/notifications/phone-verification/confirm?companyId=${companyId}`,
      { method: 'POST', body: JSON.stringify({ code }) },
    ),
  log: (companyId: number, opts: { status?: string; channel?: string; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.channel) qs.set('channel', opts.channel);
    if (opts.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<NotificationsLogRow[]>(`/companies/${companyId}/notifications-log${suffix}`);
  },
};

// ---------------------------------------------------------------------------
// AI (settings, NL corrections, support chat)
// ---------------------------------------------------------------------------

export const ai = {
  getSettings: (companyId: number) => apiFetch<AISettings>(`/companies/${companyId}/ai/settings`),
  updateSettings: (companyId: number, body: UpdateAISettingsRequest) =>
    apiFetch<AISettings>(`/companies/${companyId}/ai/settings`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  previewCorrection: (companyId: number, body: NLCorrectionRequest) =>
    apiFetch<NLCorrectionPreview>(`/companies/${companyId}/ai/nl-correction/preview`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  applyCorrection: (companyId: number, body: NLCorrectionApplyRequest) =>
    apiFetch<NLCorrectionApplyResult>(`/companies/${companyId}/ai/nl-correction/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  chat: (companyId: number, body: ChatRequest) =>
    apiFetch<ChatResponse>(`/companies/${companyId}/ai/chat`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Licensing
// ---------------------------------------------------------------------------

export const licensing = {
  /**
   * Read the derived license status for a single company. Internal
   * companies always show `internal_free`; everyone else mirrors the
   * appliance-wide license state. Upload and clear have moved to
   * admin.uploadLicense / admin.clearLicense — this surface is
   * read-only now.
   */
  getStatus: (companyId: number) => apiFetch<LicenseStatus>(`/companies/${companyId}/license`),
  setInternalFlag: (companyId: number, isInternal: boolean) =>
    apiFetch<LicenseStatus>(`/companies/${companyId}/license/internal-flag`, {
      method: 'PATCH',
      body: JSON.stringify({ isInternal }),
    }),
};

// ---------------------------------------------------------------------------
// Appliance admin (SuperAdmin only)
// ---------------------------------------------------------------------------

export interface ApplianceHealth {
  appliance: {
    id: string;
    version: string;
    gitSha: string;
    buildDate: string;
    nodeEnv: string;
  };
  checks: {
    db: 'ok' | 'fail';
    licensingEnforced: boolean;
    notificationsDisabled: boolean;
    aiProviderDefault: string;
  };
  companies: Array<{
    id: number;
    name: string;
    slug: string;
    isInternal: boolean;
    licenseState: string;
    employeeCount: number;
  }>;
  runtime: {
    openTimeEntries: number;
    notifications24h: Record<string, number>;
  };
  timestamp: string;
}

export const admin = {
  health: () => apiFetch<ApplianceHealth>('/admin/health'),
  exportCompanyUrl: (companyId: number) => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';
    return `${apiBase}/admin/companies/${companyId}/export-all`;
  },
  licenseStatus: () => apiFetch<LicenseStatus>('/admin/license'),
  uploadLicense: (jwt: string) =>
    apiFetch<LicenseStatus>('/admin/license', {
      method: 'POST',
      body: JSON.stringify({ jwt }),
    }),
  clearLicense: () => apiFetch<void>('/admin/license', { method: 'DELETE' }),
  updateStatus: () => apiFetch<UpdateStatusResponse>('/admin/update/status'),
  updateCheck: () =>
    apiFetch<UpdateCheckResponse>('/admin/update/check', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  updateRun: () =>
    apiFetch<UpdateRunResponse>('/admin/update/run', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  updateLog: (since: number) =>
    apiFetch<UpdateLogResponse>(`/admin/update/log?since=${Math.max(0, since)}`),
  settings: () => apiFetch<ApplianceSettings>('/admin/settings'),
  updateSettings: (body: UpdateApplianceSettingsRequest) =>
    apiFetch<ApplianceSettings>('/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
