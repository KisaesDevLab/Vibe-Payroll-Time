// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Employee notification preferences
// ---------------------------------------------------------------------------

export const employeePreferencesSchema = z.object({
  employeeId: z.number().int().positive(),
  emailNotificationsEnabled: z.boolean(),
  smsNotificationsEnabled: z.boolean(),
  phoneVerified: z.boolean(),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
});
export type EmployeePreferences = z.infer<typeof employeePreferencesSchema>;

export const updateEmployeePreferencesRequestSchema = z.object({
  emailNotificationsEnabled: z.boolean().optional(),
  smsNotificationsEnabled: z.boolean().optional(),
});
export type UpdateEmployeePreferencesRequest = z.infer<
  typeof updateEmployeePreferencesRequestSchema
>;

// ---------------------------------------------------------------------------
// Phone verification
// ---------------------------------------------------------------------------

export const requestPhoneVerificationSchema = z.object({
  /** E.164 recommended, but we don't enforce format — Twilio rejects
   *  malformed numbers at send time. */
  phone: z.string().min(7).max(32),
});
export type RequestPhoneVerification = z.infer<typeof requestPhoneVerificationSchema>;

export const confirmPhoneVerificationSchema = z.object({
  code: z
    .string()
    .length(6)
    .regex(/^\d{6}$/, 'Code must be 6 digits'),
});
export type ConfirmPhoneVerification = z.infer<typeof confirmPhoneVerificationSchema>;

// ---------------------------------------------------------------------------
// Admin notifications log view
// ---------------------------------------------------------------------------

export const notificationsLogRowSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  recipientType: z.enum(['employee', 'user']),
  recipientId: z.number().int().positive().nullable(),
  recipientAddress: z.string(),
  channel: z.enum(['email', 'sms']),
  type: z.string(),
  status: z.enum(['queued', 'sent', 'failed', 'skipped', 'disabled']),
  providerMessageId: z.string().nullable(),
  error: z.string().nullable(),
  queuedAt: z.string().datetime(),
  sentAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
});
export type NotificationsLogRow = z.infer<typeof notificationsLogRowSchema>;

export const notificationsLogQuerySchema = z.object({
  status: z.enum(['queued', 'sent', 'failed', 'skipped', 'disabled']).optional(),
  channel: z.enum(['email', 'sms']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type NotificationsLogQuery = z.infer<typeof notificationsLogQuerySchema>;
