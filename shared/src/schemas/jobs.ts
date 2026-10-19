// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { z } from 'zod';

/**
 * Time-off categories. A time-off job code records paid-but-not-worked
 * (or unpaid) time; it never counts toward FLSA overtime. `other` covers
 * firm-defined codes such as bereavement or jury duty.
 */
export const TIME_OFF_CATEGORIES = ['pto', 'sick', 'holiday', 'unpaid', 'other'] as const;
export const timeOffCategorySchema = z.enum(TIME_OFF_CATEGORIES);
export type TimeOffCategory = z.infer<typeof timeOffCategorySchema>;

export const TIME_OFF_CATEGORY_LABELS: Record<TimeOffCategory, string> = {
  pto: 'PTO',
  sick: 'Sick',
  holiday: 'Holiday',
  unpaid: 'Unpaid leave',
  other: 'Other time off',
};

/** The four types a company can switch on under Settings → Time off,
 *  each backed by one job code. */
export const DEFAULT_TIME_OFF_TYPES = [
  { category: 'pto', code: 'PTO', name: 'Paid time off', isPaid: true },
  { category: 'sick', code: 'SICK', name: 'Sick pay', isPaid: true },
  { category: 'holiday', code: 'HOLIDAY', name: 'Holiday pay', isPaid: true },
  { category: 'unpaid', code: 'UNPAID', name: 'Unpaid leave', isPaid: false },
] as const satisfies ReadonlyArray<{
  category: TimeOffCategory;
  code: string;
  name: string;
  isPaid: boolean;
}>;
export type DefaultTimeOffCategory = (typeof DEFAULT_TIME_OFF_TYPES)[number]['category'];

export const jobSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  /** A time-off code (PTO, sick, …) rather than a job worked on. */
  isTimeOff: z.boolean(),
  /** Set iff `isTimeOff`. */
  timeOffCategory: timeOffCategorySchema.nullable(),
  /** False for unpaid leave. Meaningful only on time-off codes. */
  isPaid: z.boolean(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const createJobRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  isTimeOff: z.boolean().optional(),
  timeOffCategory: timeOffCategorySchema.nullable().optional(),
  isPaid: z.boolean().optional(),
});
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const updateJobRequestSchema = createJobRequestSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateJobRequest = z.infer<typeof updateJobRequestSchema>;

/** Settings → Time off: which of the four standard types are switched on. */
export const timeOffTypeStateSchema = z.object({
  category: timeOffCategorySchema,
  code: z.string(),
  name: z.string(),
  isPaid: z.boolean(),
  enabled: z.boolean(),
  /** The job backing this type, once it has ever been switched on. */
  jobId: z.number().int().positive().nullable(),
});
export type TimeOffTypeState = z.infer<typeof timeOffTypeStateSchema>;

export const setTimeOffTypeRequestSchema = z.object({
  enabled: z.boolean(),
});
export type SetTimeOffTypeRequest = z.infer<typeof setTimeOffTypeRequestSchema>;
