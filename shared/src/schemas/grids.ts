import { z } from 'zod';
import { timeEntrySchema } from './punch.js';

// ---------------------------------------------------------------------------
// Weekly grid — one employee across 7 days × N jobs.
// ---------------------------------------------------------------------------

export const weeklyGridJobSchema = z.object({
  id: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  archivedAt: z.string().datetime().nullable(),
});
export type WeeklyGridJob = z.infer<typeof weeklyGridJobSchema>;

/** One cell = (job × day). Rolled up from any entries that overlap the
 *  day, filtering out superseded punches. */
export const weeklyGridCellSchema = z.object({
  jobId: z.number().int().positive().nullable(),
  /** YYYY-MM-DD in company TZ. */
  date: z.string(),
  /** Sum of non-superseded entries for this (job, day) in seconds. Zero
   *  when the cell has no entries. */
  seconds: z.number().int().nonnegative(),
  /** `punched` = only kiosk/web/mobile_pwa entries contribute; `manual`
   *  = a web_manual entry supersedes everything; `mixed` = both contribute
   *  (only possible when the manual entry supersedes partial punches); `none`
   *  = no entries today for this job. */
  sourceTag: z.enum(['punched', 'manual', 'mixed', 'none']),
  /** The manual entry's id if sourceTag is `manual` or `mixed`, so the
   *  popover can open in edit mode. Null otherwise. */
  manualEntryId: z.number().int().positive().nullable(),
  /** Present on `mixed`/`manual` cells — the reason text the user
   *  provided when creating the override. */
  entryReason: z.string().nullable(),
  /** True if the cell sits in an already-approved pay period. */
  locked: z.boolean(),
});
export type WeeklyGridCell = z.infer<typeof weeklyGridCellSchema>;

export const weeklyGridDaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  totalSeconds: z.number().int().nonnegative(),
  hasException: z.boolean(),
  hasManual: z.boolean(),
});
export type WeeklyGridDay = z.infer<typeof weeklyGridDaySchema>;

export const weeklyGridResponseSchema = z.object({
  employee: z.object({
    id: z.number().int().positive(),
    firstName: z.string(),
    lastName: z.string(),
    companyId: z.number().int().positive(),
  }),
  week: z.object({
    start: z.string(), // YYYY-MM-DD, local-midnight
    end: z.string(), // exclusive
  }),
  jobs: z.array(weeklyGridJobSchema),
  days: z.array(weeklyGridDaySchema),
  cells: z.array(weeklyGridCellSchema),
  /** Row total per job across the week. */
  jobTotals: z.array(
    z.object({
      jobId: z.number().int().positive().nullable(),
      seconds: z.number().int().nonnegative(),
    }),
  ),
  /** All non-superseded entries in the week, in case the UI needs full
   *  provenance (e.g. audit trail). */
  entries: z.array(timeEntrySchema),
  weekTotalSeconds: z.number().int().nonnegative(),
  /** True if every entry in the week is approved. */
  allApproved: z.boolean(),
  /** Effective format preference for the caller — server-resolved so
   *  client and server stay in lockstep. */
  timeFormat: z.enum(['decimal', 'hhmm']),
});
export type WeeklyGridResponse = z.infer<typeof weeklyGridResponseSchema>;

// ---------------------------------------------------------------------------
// Multi-employee grid — all employees × 7 days.
// ---------------------------------------------------------------------------

export const multiEmployeeDayCellSchema = z.object({
  date: z.string(),
  seconds: z.number().int().nonnegative(),
  hasException: z.boolean(),
  hasManual: z.boolean(),
  /** Contribution to weekly OT; lets the UI paint brass for OT-bearing
   *  cells without recomputing client-side. */
  contributesToOT: z.boolean(),
});
export type MultiEmployeeDayCell = z.infer<typeof multiEmployeeDayCellSchema>;

export const multiEmployeeRowSchema = z.object({
  id: z.number().int().positive(),
  firstName: z.string(),
  lastName: z.string(),
  days: z.array(multiEmployeeDayCellSchema),
  weekSeconds: z.number().int().nonnegative(),
  regularSeconds: z.number().int().nonnegative(),
  overtimeSeconds: z.number().int().nonnegative(),
  allApproved: z.boolean(),
  hasPending: z.boolean(),
});
export type MultiEmployeeRow = z.infer<typeof multiEmployeeRowSchema>;

export const multiEmployeeGridResponseSchema = z.object({
  companyId: z.number().int().positive(),
  week: z.object({
    start: z.string(),
    end: z.string(),
  }),
  rows: z.array(multiEmployeeRowSchema),
  dailyTotals: z.array(
    z.object({
      date: z.string(),
      seconds: z.number().int().nonnegative(),
    }),
  ),
  grandTotalSeconds: z.number().int().nonnegative(),
  stats: z.object({
    employeeCount: z.number().int().nonnegative(),
    regularSeconds: z.number().int().nonnegative(),
    overtimeSeconds: z.number().int().nonnegative(),
    cellsNeedingReview: z.number().int().nonnegative(),
  }),
  timeFormat: z.enum(['decimal', 'hhmm']),
});
export type MultiEmployeeGridResponse = z.infer<typeof multiEmployeeGridResponseSchema>;
