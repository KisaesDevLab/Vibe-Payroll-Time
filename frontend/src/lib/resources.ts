import type {
  ApprovePeriodRequest,
  ApprovePeriodResponse,
  Company,
  CompanySettings,
  CorrectionRequest,
  CreateCorrectionRequest,
  CreateEmployeeRequest,
  CreateJobRequest,
  CreateKioskPairingCodeRequest,
  CsvImportRequest,
  CsvImportResponse,
  DecideCorrectionRequest,
  EditEntryRequest,
  Employee,
  EmployeeWithPinResponse,
  EntryAuditRow,
  EmployeePreferences,
  InviteMembershipRequest,
  Job,
  KioskDevice,
  KioskPairingCodeResponse,
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
  UpdateJobRequest,
} from '@vibept/shared';
import { apiFetch } from './api';

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
