import { z } from 'zod';

const slugRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export const companySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(200),
  slug: z.string().max(64),
  timezone: z.string().max(64),
  weekStartDay: z.number().int().min(0).max(6),
  payPeriodType: z.enum(['weekly', 'bi_weekly', 'semi_monthly', 'monthly']),
  payPeriodAnchor: z.string().nullable(),
  isInternal: z.boolean(),
  licenseState: z.enum(['internal_free', 'trial', 'licensed', 'grace', 'expired']),
  licenseExpiresAt: z.string().datetime().nullable(),
  disabledAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  employeeCount: z.number().int().nonnegative().optional(),
});
export type Company = z.infer<typeof companySchema>;

export const createCompanyRequestSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(2).max(64).regex(slugRegex, 'slug must be kebab-case'),
  timezone: z.string().min(1).max(64),
  weekStartDay: z.number().int().min(0).max(6).default(0),
  payPeriodType: z.enum(['weekly', 'bi_weekly', 'semi_monthly', 'monthly']).default('bi_weekly'),
  payPeriodAnchor: z.string().date().optional(),
  isInternal: z.boolean().default(false),
});
export type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;

export const updateCompanyRequestSchema = createCompanyRequestSchema.partial();
export type UpdateCompanyRequest = z.infer<typeof updateCompanyRequestSchema>;

// ---------------------------------------------------------------------------
// Company settings
// ---------------------------------------------------------------------------

export const companySettingsSchema = z.object({
  companyId: z.number().int().positive(),
  punchRoundingMode: z.enum(['none', '1min', '5min', '6min', '15min']),
  punchRoundingGraceMinutes: z.number().int().min(0).max(15),
  autoClockoutHours: z.number().int().min(4).max(24),
  missedPunchReminderHours: z.number().int().min(1).max(48),
  supervisorApprovalRequired: z.boolean(),
  allowSelfApprove: z.boolean(),
  kioskEnabled: z.boolean(),
  personalDeviceEnabled: z.boolean(),
  twilioAccountSid: z.string().nullable(),
  twilioFromNumber: z.string().nullable(),
  /** True iff the encrypted blob is populated. Plaintext is never returned. */
  twilioAuthTokenConfigured: z.boolean(),
  smtpHost: z.string().nullable(),
  smtpPort: z.number().int().nullable(),
  smtpUser: z.string().nullable(),
  smtpFrom: z.string().nullable(),
  smtpPasswordConfigured: z.boolean(),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const updateCompanySettingsRequestSchema = z
  .object({
    punchRoundingMode: z.enum(['none', '1min', '5min', '6min', '15min']),
    punchRoundingGraceMinutes: z.number().int().min(0).max(15),
    autoClockoutHours: z.number().int().min(4).max(24),
    missedPunchReminderHours: z.number().int().min(1).max(48),
    supervisorApprovalRequired: z.boolean(),
    allowSelfApprove: z.boolean(),
    kioskEnabled: z.boolean(),
    personalDeviceEnabled: z.boolean(),
    twilioAccountSid: z.string().max(64).nullable(),
    /** Provide a new plaintext token; null clears the stored secret. Omit to
     *  leave the existing encrypted value untouched. */
    twilioAuthToken: z.string().max(256).nullable().optional(),
    twilioFromNumber: z.string().max(32).nullable(),
    smtpHost: z.string().max(254).nullable(),
    smtpPort: z.number().int().min(1).max(65535).nullable(),
    smtpUser: z.string().max(254).nullable(),
    smtpPassword: z.string().max(256).nullable().optional(),
    smtpFrom: z.string().max(254).nullable(),
  })
  .partial()
  .refine(
    (v) => v.kioskEnabled !== false || v.personalDeviceEnabled !== false,
    'At least one auth surface must remain enabled',
  );
export type UpdateCompanySettingsRequest = z.infer<typeof updateCompanySettingsRequestSchema>;
