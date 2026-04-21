import { z } from 'zod';
import { authResponseSchema } from './auth.js';

/** First-run setup wizard request. Creates the SuperAdmin user and the
 *  firm's internal company in a single transaction. */
export const setupInitialRequestSchema = z.object({
  appliance: z.object({
    timezone: z.string().min(1).max(64),
  }),
  admin: z.object({
    email: z.string().email().max(254),
    password: z.string().min(12).max(256),
    /** Optional — lets the SuperAdmin receive appliance-wide SMS
     *  notifications later. Null/omitted = email-only account. */
    phone: z
      .string()
      .regex(/^\+?[0-9][0-9\s()\-.]{5,}$/, 'phone must be digits; prefix with + for E.164')
      .max(32)
      .optional(),
  }),
  company: z.object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug must be kebab-case'),
    timezone: z.string().min(1).max(64),
    weekStartDay: z.number().int().min(0).max(6).default(0),
    payPeriodType: z.enum(['weekly', 'bi_weekly', 'semi_monthly', 'monthly']).default('bi_weekly'),
  }),
});
export type SetupInitialRequest = z.infer<typeof setupInitialRequestSchema>;

/** Returned after a successful setup — tokens + user so the wizard can
 *  redirect straight into the admin UI. */
export const setupInitialResponseSchema = authResponseSchema;
export type SetupInitialResponse = z.infer<typeof setupInitialResponseSchema>;

/** Status for GET /setup/status — governs whether the setup wizard is shown. */
export const setupStatusResponseSchema = z.object({
  setupRequired: z.boolean(),
  installationId: z.string().nullable(),
});
export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
