// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
export const GlobalRole = {
  SuperAdmin: 'super_admin',
  None: 'none',
} as const;
export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];

export const CompanyRole = {
  CompanyAdmin: 'company_admin',
  Supervisor: 'supervisor',
  Employee: 'employee',
} as const;
export type CompanyRole = (typeof CompanyRole)[keyof typeof CompanyRole];

export const EmployeeStatus = {
  Active: 'active',
  Terminated: 'terminated',
} as const;
export type EmployeeStatus = (typeof EmployeeStatus)[keyof typeof EmployeeStatus];

export const EntryType = {
  Work: 'work',
  Break: 'break',
} as const;
export type EntryType = (typeof EntryType)[keyof typeof EntryType];

export const PunchSource = {
  Kiosk: 'kiosk',
  Web: 'web',
  MobilePwa: 'mobile_pwa',
  /** Manager/supervisor-supplied override or allocation; distinct from
   *  `web` (which is a live web-PWA punch). Always carries an
   *  `entry_reason` and may carry `supersedes_entry_ids` for punch
   *  replacements. */
  WebManual: 'web_manual',
} as const;
export type PunchSource = (typeof PunchSource)[keyof typeof PunchSource];

export const EmployeeManualEntryMode = {
  Allowed: 'allowed',
  OverrideOnly: 'override_only',
  Disabled: 'disabled',
} as const;
export type EmployeeManualEntryMode =
  (typeof EmployeeManualEntryMode)[keyof typeof EmployeeManualEntryMode];

export const TimeFormat = {
  Decimal: 'decimal',
  Hhmm: 'hhmm',
} as const;
export type TimeFormat = (typeof TimeFormat)[keyof typeof TimeFormat];

export const PayPeriodType = {
  Weekly: 'weekly',
  BiWeekly: 'bi_weekly',
  SemiMonthly: 'semi_monthly',
  Monthly: 'monthly',
} as const;
export type PayPeriodType = (typeof PayPeriodType)[keyof typeof PayPeriodType];

export const RoundingMode = {
  None: 'none',
  OneMinute: '1min',
  FiveMinute: '5min',
  SixMinute: '6min',
  FifteenMinute: '15min',
} as const;
export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

export const LicenseState = {
  InternalFree: 'internal_free',
  Trial: 'trial',
  Licensed: 'licensed',
  Grace: 'grace',
  Expired: 'expired',
} as const;
export type LicenseState = (typeof LicenseState)[keyof typeof LicenseState];

export const AuditAction = {
  Create: 'create',
  Edit: 'edit',
  Approve: 'approve',
  Unapprove: 'unapprove',
  Delete: 'delete',
  AutoClose: 'auto_close',
  ManualCreate: 'manual_create',
  ManualUpdate: 'manual_update',
  ManualDelete: 'manual_delete',
  ManualOverride: 'manual_override',
  ManualRevert: 'manual_revert',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const CorrectionRequestType = {
  Edit: 'edit',
  Add: 'add',
  Delete: 'delete',
} as const;
export type CorrectionRequestType =
  (typeof CorrectionRequestType)[keyof typeof CorrectionRequestType];

export const KioskAuthMode = {
  Pin: 'pin',
  Qr: 'qr',
  Both: 'both',
} as const;
export type KioskAuthMode = (typeof KioskAuthMode)[keyof typeof KioskAuthMode];

export const BadgeEventType = {
  Issue: 'issue',
  Revoke: 'revoke',
  ScanSuccess: 'scan_success',
  ScanFailure: 'scan_failure',
} as const;
export type BadgeEventType = (typeof BadgeEventType)[keyof typeof BadgeEventType];

export const CorrectionRequestStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const;
export type CorrectionRequestStatus =
  (typeof CorrectionRequestStatus)[keyof typeof CorrectionRequestStatus];
