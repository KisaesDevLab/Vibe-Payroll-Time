// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { z } from 'zod';

/**
 * Missing-time reminders. A "missing day" is one of the employee's
 * expected work days in a pay period, on or after their hire date and
 * before today (company time), with no work or time-off entry at all.
 */

/** `current` = the pay period containing today; `previous` = the one
 *  that ended most recently. */
export const missingTimePeriodSchema = z.enum(['current', 'previous']);
export type MissingTimePeriod = z.infer<typeof missingTimePeriodSchema>;

/** Why an employee with missing days can't be reminded. */
export const missingTimeSkipReasonSchema = z.enum([
  /** Pay period approved; the employee can no longer change it. */
  'approved',
  /** Can't sign in (no account, sign-in off, or the company is kiosk-only). */
  'kiosk_only',
  /** An admin switched reminders off for this employee. */
  'opted_out',
  /** No email (or email off) and no verified phone with texts on. */
  'no_contact',
]);
export type MissingTimeSkipReason = z.infer<typeof missingTimeSkipReasonSchema>;

export const missingTimeEmployeeSchema = z.object({
  employeeId: z.number().int().positive(),
  firstName: z.string(),
  lastName: z.string(),
  /** YYYY-MM-DD, company-local, ascending. */
  missingDates: z.array(z.string()),
  /** Null when a reminder can be sent. */
  skipReason: missingTimeSkipReasonSchema.nullable(),
  /** Reminders already sent for this period (automatic + manual). */
  remindersSent: z.number().int().nonnegative(),
  lastRemindedAt: z.string().datetime().nullable(),
});
export type MissingTimeEmployee = z.infer<typeof missingTimeEmployeeSchema>;

export const missingTimeReportSchema = z.object({
  period: z.object({
    which: missingTimePeriodSchema,
    /** YYYY-MM-DD, company-local, inclusive. */
    start: z.string(),
    end: z.string(),
  }),
  /** Last day checked (yesterday for the current period). Null when the
   *  period has no past days yet. */
  checkedThrough: z.string().nullable(),
  /** Only employees with at least one missing day. */
  employees: z.array(missingTimeEmployeeSchema),
});
export type MissingTimeReport = z.infer<typeof missingTimeReportSchema>;

export const missingTimeReportQuerySchema = z.object({
  period: missingTimePeriodSchema.default('previous'),
});

export const sendMissingTimeRemindersRequestSchema = z.object({
  period: missingTimePeriodSchema,
  employeeIds: z.array(z.number().int().positive()).min(1).max(1000),
});
export type SendMissingTimeRemindersRequest = z.infer<typeof sendMissingTimeRemindersRequestSchema>;

export const sendMissingTimeRemindersResponseSchema = z.object({
  sent: z.number().int().nonnegative(),
  skipped: z.array(
    z.object({
      employeeId: z.number().int().positive(),
      reason: z.union([missingTimeSkipReasonSchema, z.literal('no_missing_days')]),
    }),
  ),
});
export type SendMissingTimeRemindersResponse = z.infer<
  typeof sendMissingTimeRemindersResponseSchema
>;
