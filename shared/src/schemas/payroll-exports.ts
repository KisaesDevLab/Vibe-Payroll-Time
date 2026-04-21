import { z } from 'zod';

export const payrollFormatSchema = z.enum([
  'payroll_relief',
  'gusto',
  'qbo_payroll',
  'generic_csv',
]);
export type PayrollFormat = z.infer<typeof payrollFormatSchema>;

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export const preflightEmployeeStatusSchema = z.object({
  employeeId: z.number().int().positive(),
  firstName: z.string(),
  lastName: z.string(),
  allApproved: z.boolean(),
  hasOpenEntry: z.boolean(),
  hasPendingCorrection: z.boolean(),
  workSeconds: z.number().int().nonnegative(),
});
export type PreflightEmployeeStatus = z.infer<typeof preflightEmployeeStatusSchema>;

export const preflightResponseSchema = z.object({
  ready: z.boolean(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  employees: z.array(preflightEmployeeStatusSchema),
  blockingIssues: z.array(z.string()),
  priorExports: z.array(
    z.object({
      id: z.number().int().positive(),
      format: payrollFormatSchema,
      exportedAt: z.string().datetime(),
      exportedBy: z.string().nullable(), // email
    }),
  ),
});
export type PreflightResponse = z.infer<typeof preflightResponseSchema>;

export const preflightRequestSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type PreflightRequest = z.infer<typeof preflightRequestSchema>;

// ---------------------------------------------------------------------------
// Run export
// ---------------------------------------------------------------------------

export const runExportRequestSchema = z.object({
  format: payrollFormatSchema,
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  /** Required if re-exporting over an existing run for the same
   *  (company, period, format). UX warns first; body must opt in. */
  acknowledgeReExport: z.boolean().default(false),
  /** Optional admin-supplied note, surfaced in the history view. */
  notes: z.string().max(500).optional(),
  /** `generic_csv` only: which columns to include, in order. Ignored
   *  for the three vendor formats. */
  genericColumns: z.array(z.string().min(1).max(64)).optional(),
  /** `generic_csv` only: how hour columns render. Vendor formats (Payroll
   *  Relief / Gusto / QBO) stay decimal regardless because those
   *  targets only ingest decimal natively. Defaults to 'decimal'. */
  genericTimeFormat: z.enum(['decimal', 'hhmm']).optional(),
});
export type RunExportRequest = z.infer<typeof runExportRequestSchema>;

// ---------------------------------------------------------------------------
// Payroll export record (returned by run + history)
// ---------------------------------------------------------------------------

export const payrollExportSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  exportedByEmail: z.string().nullable(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  format: payrollFormatSchema,
  fileBytes: z.number().int().nonnegative(),
  fileHash: z.string(),
  employeeCount: z.number().int().nonnegative(),
  totalWorkSeconds: z.number().int().nonnegative(),
  replacedById: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  exportedAt: z.string().datetime(),
});
export type PayrollExport = z.infer<typeof payrollExportSchema>;

// Columns the generic CSV exporter understands. Kept here so the UI
// can render a checklist that matches the server's vocabulary.
export const GENERIC_COLUMN_KEYS = [
  'employee_number',
  'last_name',
  'first_name',
  'email',
  'regular_hours',
  'overtime_hours',
  'break_hours',
  'total_hours',
  'job_breakdown_json',
  'period_start',
  'period_end',
  // Phase 6.5 manual-entry columns — how much of this employee's work
  // came from a supervisor-entered manual override rather than a
  // punch, plus the reasons attached. Kept optional so existing
  // templates are unaffected.
  'manual_hours',
  'source',
  'override_reasons',
] as const;
export type GenericColumnKey = (typeof GENERIC_COLUMN_KEYS)[number];
