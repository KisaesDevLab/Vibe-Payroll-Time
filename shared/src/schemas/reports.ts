// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
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
  /** Params schema serialized as a simple field list the UI can render.
   *
   * Type semantics:
   *   - `date`            HTML date input
   *   - `companyScoped`   Employee picker (renders the active roster)
   *   - `enum`            Dropdown; `choices` lists {value,label} pairs
   */
  params: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(['date', 'companyScoped', 'enum']),
      required: z.boolean(),
      choices: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
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

/**
 * Punch activity — the investigation view. Every closed entry for a
 * period, with network attribution, source device, and exception flags
 * so a supervisor can hunt for anomalies. All filters except the period
 * are optional; empty means "don't filter".
 */
export const punchActivityParamsSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  /** Single employee id, or empty for all. */
  employeeId: z.coerce.number().int().positive().optional(),
  /** all | kiosk | web | mobile_pwa */
  source: z.enum(['all', 'kiosk', 'web', 'mobile_pwa']).optional(),
  /** all | approved | pending */
  approvedState: z.enum(['all', 'approved', 'pending']).optional(),
  /** all | exceptions_only — auto-closed, offline, or edited */
  flag: z.enum(['all', 'exceptions_only']).optional(),
});
export type PunchActivityParams = z.infer<typeof punchActivityParamsSchema>;
