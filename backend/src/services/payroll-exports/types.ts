import type { PayrollFormat, PayrollExport } from '@vibept/shared';

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
}

export interface ExportContext {
  companyId: number;
  companyName: string;
  periodStart: Date;
  periodEnd: Date;
  employees: EmployeeSummary[];
  /** Only used by the generic CSV exporter. */
  genericColumns?: string[];
}

export type { PayrollFormat, PayrollExport };

/** Pure function — emits a CSV payload string. The engine handles hashing,
 *  file writing, and recording metadata. */
export type FormatFn = (ctx: ExportContext) => string;
