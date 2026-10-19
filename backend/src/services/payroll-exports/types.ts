// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type {
  PayrollFormat,
  PayrollExport,
  TimeFormat,
  TimeOffCategory,
  TimeOffTotals,
} from '@vibept/shared';

export interface EmployeeSummary {
  employeeId: number;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  regularSeconds: number;
  overtimeSeconds: number;
  breakSeconds: number;
  workSeconds: number;
  /** Per-job breakdown for exporters (like QBO) that itemize by service/job. */
  byJob: Array<{ jobId: number | null; jobCode: string | null; workSeconds: number }>;
  /** Seconds contributed by web_manual entries (subset of workSeconds).
   *  Used by the generic CSV's source/override columns. */
  manualSeconds: number;
  /** Distinct override reasons across this employee's web_manual entries
   *  in the period. Empty when no manual entries. */
  overrideReasons: string[];
  /** Time off for the period: paid but not worked (or unpaid). Never
   *  part of regular/overtime/work seconds. */
  timeOff: TimeOffTotals;
  /** Per time-off code, for exporters that itemize (QBO). */
  timeOffByJob: Array<{
    jobId: number;
    jobCode: string | null;
    category: TimeOffCategory;
    isPaid: boolean;
    seconds: number;
  }>;
}

/**
 * Paid time off by category. Vendor exports carry only paid time off;
 * unpaid leave is attendance, not pay, and appears only in the generic
 * CSV and reports. Paid codes in `other` (bereavement, jury duty, …)
 * have no column of their own in the vendor templates.
 */
export function paidTimeOff(e: EmployeeSummary): Record<TimeOffCategory, number> {
  const out: Record<TimeOffCategory, number> = { pto: 0, sick: 0, holiday: 0, unpaid: 0, other: 0 };
  for (const t of e.timeOffByJob) if (t.isPaid) out[t.category] += t.seconds;
  return out;
}

/** An employee with nothing to pay or record this period is left out. */
export function hasHours(e: EmployeeSummary): boolean {
  return e.workSeconds > 0 || e.timeOff.totalSeconds > 0;
}

export interface ExportContext {
  companyId: number;
  companyName: string;
  periodStart: Date;
  periodEnd: Date;
  employees: EmployeeSummary[];
  /** Only used by the generic CSV exporter. */
  genericColumns?: string[];
  /** Generic-CSV only: which time format to render hour columns in.
   *  Vendor formats (Payroll Relief / Gusto / QBO) ignore this and use
   *  their native decimal. Defaults to 'decimal' when absent. */
  genericTimeFormat?: TimeFormat;
}

export type { PayrollFormat, PayrollExport };

/** Pure function — emits a CSV payload string. The engine handles hashing,
 *  file writing, and recording metadata. */
export type FormatFn = (ctx: ExportContext) => string;
