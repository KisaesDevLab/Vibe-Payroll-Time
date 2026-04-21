import { z } from 'zod';

/**
 * SuperAdmin-editable appliance config stored in the `appliance_settings`
 * singleton. Resolution for consumers (email, AI, retention, log level)
 * is DB-first with env-var fallback.
 *
 * Secret fields follow a consistent triple-state pattern:
 *   - GET never returns plaintext. Instead a boolean `*HasSecret` flag
 *     tells the UI whether one is configured.
 *   - PATCH accepts:
 *       undefined (field omitted) → no change
 *       null                      → clear the stored secret
 *       string                    → set/replace the stored secret
 */

const logLevelEnum = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const aiProviderEnum = z.enum(['anthropic', 'openai_compatible', 'ollama']);

/** Where a resolved value came from — helps the UI show "using env fallback". */
const sourceSchema = z.enum(['db', 'env', 'unset']);
export type ApplianceSettingsSource = z.infer<typeof sourceSchema>;

/** GET /admin/settings response shape. */
export const applianceSettingsSchema = z.object({
  emailit: z.object({
    apiKeyHasSecret: z.boolean(),
    apiKeySource: sourceSchema,
    fromEmail: z.string().nullable(),
    fromEmailSource: sourceSchema,
    fromName: z.string().nullable(),
    fromNameSource: sourceSchema,
    apiBaseUrl: z.string().nullable(),
    apiBaseUrlSource: sourceSchema,
  }),
  ai: z.object({
    provider: aiProviderEnum,
    providerSource: sourceSchema,
    apiKeyHasSecret: z.boolean(),
    apiKeySource: sourceSchema,
    model: z.string().nullable(),
    modelSource: sourceSchema,
    baseUrl: z.string().nullable(),
    baseUrlSource: sourceSchema,
  }),
  retentionDays: z.number().int().positive(),
  retentionDaysSource: sourceSchema,
  logLevel: logLevelEnum,
  logLevelSource: sourceSchema,
});

export type ApplianceSettings = z.infer<typeof applianceSettingsSchema>;

/**
 * PATCH /admin/settings request. Every field is optional; the field
 * being absent means "don't change". Secret fields accept null to
 * clear. Non-secret strings accept null to clear (fall back to env
 * fallback).
 */
export const updateApplianceSettingsRequestSchema = z.object({
  emailit: z
    .object({
      apiKey: z.union([z.string().min(1).max(512), z.null()]).optional(),
      fromEmail: z.union([z.string().email(), z.null()]).optional(),
      fromName: z.union([z.string().max(200), z.null()]).optional(),
      apiBaseUrl: z.union([z.string().url(), z.null()]).optional(),
    })
    .optional(),
  ai: z
    .object({
      provider: z.union([aiProviderEnum, z.null()]).optional(),
      apiKey: z.union([z.string().min(1).max(512), z.null()]).optional(),
      model: z.union([z.string().max(128), z.null()]).optional(),
      baseUrl: z.union([z.string().url(), z.null()]).optional(),
    })
    .optional(),
  retentionDays: z.union([z.number().int().positive().max(3650), z.null()]).optional(),
  logLevel: z.union([logLevelEnum, z.null()]).optional(),
});

export type UpdateApplianceSettingsRequest = z.infer<typeof updateApplianceSettingsRequestSchema>;
