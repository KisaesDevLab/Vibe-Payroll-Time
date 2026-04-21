import { z } from 'zod';
import { timeEntrySchema } from './punch.js';

// ---------------------------------------------------------------------------
// Timesheet responses
// ---------------------------------------------------------------------------

export const daySummarySchema = z.object({
  date: z.string(), // YYYY-MM-DD in company tz
  workSeconds: z.number().int().nonnegative(),
  breakSeconds: z.number().int().nonnegative(),
  entryIds: z.array(z.number().int().positive()),
});
export type DaySummary = z.infer<typeof daySummarySchema>;

export const weekSummarySchema = z.object({
  weekStart: z.string().datetime(),
  workSeconds: z.number().int().nonnegative(),
  regularSeconds: z.number().int().nonnegative(),
  overtimeSeconds: z.number().int().nonnegative(),
});
export type WeekSummary = z.infer<typeof weekSummarySchema>;

export const timesheetResponseSchema = z.object({
  employee: z.object({
    id: z.number().int().positive(),
    firstName: z.string(),
    lastName: z.string(),
    companyId: z.number().int().positive(),
  }),
  period: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    type: z.enum(['weekly', 'bi_weekly', 'semi_monthly', 'monthly']),
  }),
  entries: z.array(timeEntrySchema),
  days: z.array(daySummarySchema),
  weeks: z.array(weekSummarySchema),
  totals: z.object({
    workSeconds: z.number().int().nonnegative(),
    breakSeconds: z.number().int().nonnegative(),
    regularSeconds: z.number().int().nonnegative(),
    overtimeSeconds: z.number().int().nonnegative(),
  }),
  jobBreakdown: z.array(
    z.object({
      jobId: z.number().int().positive().nullable(),
      workSeconds: z.number().int().nonnegative(),
    }),
  ),
  /** True if every entry in the period is approved. */
  isApproved: z.boolean(),
  /** Present iff every entry has an approved_at set. */
  approvedAt: z.string().datetime().nullable(),
});
export type TimesheetResponse = z.infer<typeof timesheetResponseSchema>;

// ---------------------------------------------------------------------------
// Timesheet query + approval requests
// ---------------------------------------------------------------------------

export const timesheetQuerySchema = z.object({
  companyId: z.coerce.number().int().positive(),
  employeeId: z.coerce.number().int().positive(),
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
});
export type TimesheetQuery = z.infer<typeof timesheetQuerySchema>;

export const approvePeriodRequestSchema = z.object({
  employeeIds: z.array(z.number().int().positive()).min(1),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
});
export type ApprovePeriodRequest = z.infer<typeof approvePeriodRequestSchema>;

export const approvePeriodResponseSchema = z.object({
  approvedEntryCount: z.number().int().nonnegative(),
  /** Employees with at least one entry; present so the UI can grey out
   *  them as "already approved" next time. */
  affectedEmployeeIds: z.array(z.number().int().positive()),
});
export type ApprovePeriodResponse = z.infer<typeof approvePeriodResponseSchema>;

// ---------------------------------------------------------------------------
// Entry edit + delete (for the review UI)
// ---------------------------------------------------------------------------

export const editEntryRequestSchema = z.object({
  startedAt: z.string().datetime().optional(),
  endedAt: z.string().datetime().nullable().optional(),
  jobId: z.number().int().positive().nullable().optional(),
  entryType: z.enum(['work', 'break']).optional(),
  reason: z.string().min(1).max(500),
});
export type EditEntryRequest = z.infer<typeof editEntryRequestSchema>;

export const deleteEntryRequestSchema = z.object({
  reason: z.string().min(1).max(500),
});
export type DeleteEntryRequest = z.infer<typeof deleteEntryRequestSchema>;

/** Admin/supervisor creates a complete (closed) entry on behalf of an
 *  employee — the "missed punch" flow. Open entries (no endedAt) come
 *  only from real punches and are rejected here. */
export const createEntryRequestSchema = z.object({
  employeeId: z.number().int().positive(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  entryType: z.enum(['work', 'break']),
  jobId: z.number().int().positive().nullable().optional(),
  reason: z.string().min(1).max(500),
});
export type CreateEntryRequest = z.infer<typeof createEntryRequestSchema>;

// ---------------------------------------------------------------------------
// Correction requests
// ---------------------------------------------------------------------------

export const correctionRequestSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  timeEntryId: z.number().int().positive().nullable(),
  requesterUserId: z.number().int().positive().nullable(),
  requestType: z.enum(['edit', 'add', 'delete']),
  proposedChanges: z.record(z.string(), z.unknown()),
  reason: z.string(),
  status: z.enum(['pending', 'approved', 'rejected']),
  reviewedBy: z.number().int().positive().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CorrectionRequest = z.infer<typeof correctionRequestSchema>;

export const createCorrectionRequestSchema = z.object({
  timeEntryId: z.number().int().positive().nullable().optional(),
  requestType: z.enum(['edit', 'add', 'delete']),
  proposedChanges: z.record(z.string(), z.unknown()),
  reason: z.string().min(1).max(500),
});
export type CreateCorrectionRequest = z.infer<typeof createCorrectionRequestSchema>;

export const decideCorrectionRequestSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});
export type DecideCorrectionRequest = z.infer<typeof decideCorrectionRequestSchema>;

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export const entryAuditRowSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['create', 'edit', 'approve', 'unapprove', 'delete', 'auto_close']),
  field: z.string().nullable(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  reason: z.string().nullable(),
  actorUserId: z.number().int().positive().nullable(),
  actorEmail: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EntryAuditRow = z.infer<typeof entryAuditRowSchema>;
