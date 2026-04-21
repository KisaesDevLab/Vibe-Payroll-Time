import type { PayrollFormat, PayrollExport, TimeFormat } from '@vibept/shared';

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
