import { z } from 'zod';

// ---------------------------------------------------------------------------
// Column descriptors — used by the selector UI to render the result table
// and by the CSV writer to format values.
// ---------------------------------------------------------------------------

export const reportColumnTypeSchema = z.enum([
  'string',
  'number',
  'hours', // decimal hours (seconds / 3600)
  'date',
  'datetime',
  'boolean',
]);
export type ReportColumnType = z.infer<typeof reportColumnTypeSchema>;

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: reportColumnTypeSchema,
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

export const reportDefinitionSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  columns: z.array(reportColumnSchema),
  /** Params schema serialized as a simple field list the UI can render. */
  params: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['date', 'companyScoped']),
      required: z.boolean(),
    }),
  ),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

// ---------------------------------------------------------------------------
// Response envelopes
// ---------------------------------------------------------------------------

export const reportResultSchema = z.object({
  columns: z.array(reportColumnSchema),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  rowCount: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
export type ReportResult = z.infer<typeof reportResultSchema>;

export const reportCatalogResponseSchema = z.array(reportDefinitionSchema);
export type ReportCatalogResponse = z.infer<typeof reportCatalogResponseSchema>;

// ---------------------------------------------------------------------------
// Per-report params (client-validated; server re-validates)
// ---------------------------------------------------------------------------

export const timeCardParamsSchema = z.object({
  employeeId: z.coerce.number().int().positive(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type TimeCardParams = z.infer<typeof timeCardParamsSchema>;

export const hoursByPeriodParamsSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type HoursByPeriodParams = z.infer<typeof hoursByPeriodParamsSchema>;

export const hoursByJobParamsSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type HoursByJobParams = z.infer<typeof hoursByJobParamsSchema>;

export const overtimeParamsSchema = z.object({
  /** Optional reference date (ISO). Defaults to today — the report
   *  resolves the current work-week from this reference. */
  referenceDate: z.string().datetime().optional(),
  /** Threshold in hours that marks "approaching OT". Default 35. */
  approachingThreshold: z.coerce.number().min(0).max(60).optional(),
});
export type OvertimeParams = z.infer<typeof overtimeParamsSchema>;

export const auditTrailParamsSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  action: z.enum(['create', 'edit', 'approve', 'unapprove', 'delete', 'auto_close']).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
});
export type AuditTrailParams = z.infer<typeof auditTrailParamsSchema>;
