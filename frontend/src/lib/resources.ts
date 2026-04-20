import type {
  Company,
  CompanySettings,
  CreateEmployeeRequest,
  CreateJobRequest,
  CsvImportRequest,
  CsvImportResponse,
  Employee,
  EmployeeWithPinResponse,
  InviteMembershipRequest,
  Job,
  Membership,
  UpdateCompanyRequest,
  UpdateCompanySettingsRequest,
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
  get: (companyId: number) =>
    apiFetch<CompanySettings>(`/companies/${companyId}/settings`),
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
  list: (companyId: number) =>
    apiFetch<Membership[]>(`/companies/${companyId}/memberships`),
  invite: (companyId: number, body: InviteMembershipRequest) =>
    apiFetch<Membership>(`/companies/${companyId}/memberships`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateRole: (
    companyId: number,
    membershipId: number,
    role: Membership['role'],
  ) =>
    apiFetch<Membership>(
      `/companies/${companyId}/memberships/${membershipId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      },
    ),
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
