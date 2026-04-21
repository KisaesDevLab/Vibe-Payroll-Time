import { z } from 'zod';
import { timeEntrySchema } from './punch.js';

// ---------------------------------------------------------------------------
// Create / update / delete manual entries
// ---------------------------------------------------------------------------

export const createManualEntryRequestSchema = z.object({
  companyId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  /** YYYY-MM-DD in the company's timezone. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD'),
  jobId: z.number().int().positive().nullable(),
  durationSeconds: z.number().int().positive().max(86_400),
  reason: z.string().min(1).max(500),
  /** What the user typed before parsing; echoed into the audit row so
   *  "typed 5:48 · stored 20880s" is retrievable. */
  typedInput: z.string().max(32).optional(),
});
export type CreateManualEntryRequest = z.infer<typeof createManualEntryRequestSchema>;

export const updateManualEntryRequestSchema = z.object({
  companyId: z.number().int().positive(),
  durationSeconds: z.number().int().nonnegative().max(86_400).optional(),
  reason: z.string().min(1).max(500).optional(),
  typedInput: z.string().max(32).optional(),
});
export type UpdateManualEntryRequest = z.infer<typeof updateManualEntryRequestSchema>;

export const deleteManualEntryRequestSchema = z.object({
  companyId: z.number().int().positive(),
  reason: z.string().min(1).max(500),
});
export type DeleteManualEntryRequest = z.infer<typeof deleteManualEntryRequestSchema>;

export const manualEntryResponseSchema = z.object({
  entry: timeEntrySchema,
  /** Rows this manual entry superseded in this mutation (empty on
   *  update/delete — only create reports them). */
  supersededEntryIds: z.array(z.number().int().positive()),
});
export type ManualEntryResponse = z.infer<typeof manualEntryResponseSchema>;

// ---------------------------------------------------------------------------
// Copy last week — one-shot that duplicates every active cell from the
// prior week into the current week, skipping days that already have
// entries so we never clobber in-progress work.
// ---------------------------------------------------------------------------

export const copyLastWeekRequestSchema = z.object({
  companyId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  /** Target week start (YYYY-MM-DD, company tz). The source week is
   *  this minus 7 days. */
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().min(1).max(500),
});
export type CopyLastWeekRequest = z.infer<typeof copyLastWeekRequestSchema>;

export const copyLastWeekResponseSchema = z.object({
  createdCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  createdEntryIds: z.array(z.number().int().positive()),
});
export type CopyLastWeekResponse = z.infer<typeof copyLastWeekResponseSchema>;
