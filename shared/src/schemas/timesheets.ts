// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { z } from 'zod';
import { timeOffCategorySchema } from './jobs.js';
import { timeEntrySchema } from './punch.js';

// ---------------------------------------------------------------------------
// Timesheet responses
// ---------------------------------------------------------------------------

export const daySummarySchema = z.object({
  date: z.string(), // YYYY-MM-DD in company tz
  workSeconds: z.number().int().nonnegative(),
  breakSeconds: z.number().int().nonnegative(),
  /** Time off recorded this day; not part of workSeconds. */
  timeOffSeconds: z.number().int().nonnegative(),
  entryIds: z.array(z.number().int().positive()),
});
export type DaySummary = z.infer<typeof daySummarySchema>;

/** Time off for a period. Never part of worked hours or overtime. */
export const timeOffTotalsSchema = z.object({
  totalSeconds: z.number().int().nonnegative(),
  paidSeconds: z.number().int().nonnegative(),
  unpaidSeconds: z.number().int().nonnegative(),
  byCategory: z.record(timeOffCategorySchema, z.number().int().nonnegative()),
});
export type TimeOffTotalsResponse = z.infer<typeof timeOffTotalsSchema>;

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
    /** Exclusive: the next period's first instant. */
    end: z.string().datetime(),
    /** First civil day of the period (YYYY-MM-DD, company tz). */
    firstDay: z.string(),
    /** Last civil day of the period, inclusive (YYYY-MM-DD, company tz). */
    lastDay: z.string(),
    type: z.enum(['weekly', 'bi_weekly', 'semi_monthly', 'monthly']),
  }),
  /** IANA timezone the company's days, periods and clock times use. All
   *  times on the timesheet are shown and entered in this zone. */
  companyTimezone: z.string(),
  /** Effective hours display format for the viewer (user pref → company
   *  default), resolved server-side like the grid payload's. */
  timeFormat: z.enum(['decimal', 'hhmm']),
  /** Active entries only: superseded punches are left out, as they are of
   *  every total. */
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
  timeOff: timeOffTotalsSchema,
  timeOffBreakdown: z.array(
    z.object({
      jobId: z.number().int().positive(),
      category: timeOffCategorySchema,
      isPaid: z.boolean(),
      seconds: z.number().int().nonnegative(),
    }),
  ),
  /** May the employee record their own time off at this company? Drives
   *  the "Time off" button on My timesheet. */
  timeOffSelfEntry: z.boolean(),
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
  /** Show the pay period containing this instant (default: now). Ignored
   *  when periodStart/periodEnd are given. */
  at: z.string().datetime().optional(),
});
export type TimesheetQuery = z.infer<typeof timesheetQuerySchema>;

export const approvePeriodRequestSchema = z.object({
  // Cap batch size so a single POST can't kick off tens of thousands of
  // serialized per-employee transactions. 2000 is well above any real
  // CPA-firm payroll run but blocks runaway clients.
  employeeIds: z.array(z.number().int().positive()).min(1).max(2000),
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

/** Employee adds time they forgot to punch, from their own timesheet.
 *  Saved straight away when the company's manual-entry policy allows it;
 *  otherwise (or on an approved day) it becomes an `add` correction
 *  request for a supervisor. */
export const addOwnEntryRequestSchema = z.object({
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  jobId: z.number().int().positive().nullable().optional(),
  reason: z.string().trim().min(1).max(500),
});
export type AddOwnEntryRequest = z.infer<typeof addOwnEntryRequestSchema>;

// ---------------------------------------------------------------------------
// Correction requests
// ---------------------------------------------------------------------------

export const correctionRequestSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  /** "First Last" — present on list responses so reviewers see who asked. */
  employeeName: z.string().optional(),
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

export const addOwnEntryResponseSchema = z.object({
  /** `added`: the entry is on the timesheet. `requested`: it waits for a
   *  supervisor's approval. */
  status: z.enum(['added', 'requested']),
  entry: timeEntrySchema.nullable(),
  request: correctionRequestSchema.nullable(),
});
export type AddOwnEntryResponse = z.infer<typeof addOwnEntryResponseSchema>;

/** What an `edit` correction may propose: new times, job or type for an
 *  existing entry. At least one field. */
export const proposedEditChangesSchema = z
  .object({
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    jobId: z.number().int().positive().nullable().optional(),
    entryType: z.enum(['work', 'break']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Propose at least one change' });

/** What an `add` correction proposes: a complete, closed entry. */
export const proposedAddChangesSchema = z
  .object({
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    jobId: z.number().int().positive().nullable().optional(),
    entryType: z.enum(['work', 'break']).optional(),
  })
  .strict();

export const createCorrectionRequestSchema = z
  .object({
    timeEntryId: z.number().int().positive().nullable().optional(),
    requestType: z.enum(['edit', 'add', 'delete']),
    proposedChanges: z.record(z.string(), z.unknown()),
    reason: z.string().min(1).max(500),
  })
  .superRefine((v, ctx) => {
    const schema =
      v.requestType === 'edit'
        ? proposedEditChangesSchema
        : v.requestType === 'add'
          ? proposedAddChangesSchema
          : z.object({}).strict();
    const r = schema.safeParse(v.proposedChanges);
    if (!r.success) {
      for (const issue of r.error.issues) {
        ctx.addIssue({ ...issue, path: ['proposedChanges', ...issue.path] });
      }
    }
    if (v.requestType !== 'add' && v.timeEntryId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeEntryId'],
        message: `A ${v.requestType} request needs the entry it applies to`,
      });
    }
  });
export type CreateCorrectionRequest = z.infer<typeof createCorrectionRequestSchema>;

/** The signed-in employee's own correction requests, newest first. */
export const myCorrectionRequestsResponseSchema = z.array(correctionRequestSchema);
export type MyCorrectionRequestsResponse = z.infer<typeof myCorrectionRequestsResponseSchema>;

export const decideCorrectionRequestSchema = z.object({
  reviewNote: z.string().max(500).optional(),
});
export type DecideCorrectionRequest = z.infer<typeof decideCorrectionRequestSchema>;

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

export const entryAuditRowSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum([
    'create',
    'edit',
    'approve',
    'unapprove',
    'delete',
    'auto_close',
    'manual_create',
    'manual_update',
    'manual_delete',
    'manual_override',
    'manual_revert',
  ]),
  field: z.string().nullable(),
  oldValue: z.unknown(),
  newValue: z.unknown(),
  reason: z.string().nullable(),
  actorUserId: z.number().int().positive().nullable(),
  actorEmail: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type EntryAuditRow = z.infer<typeof entryAuditRowSchema>;
