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
const smsProviderEnum = z.enum(['twilio', 'textlinksms']);
export type SmsProvider = z.infer<typeof smsProviderEnum>;

/** Where a resolved value came from — helps the UI show "using env fallback". */
const sourceSchema = z.enum(['db', 'env', 'unset']);
export type ApplianceSettingsSource = z.infer<typeof sourceSchema>;

/** GET /admin/settings response shape. */
export const applianceSettingsSchema = z.object({
  /** Custom brand name shown in the TopBar / login page. Null means
   *  fall back to the product default ("Vibe Payroll Time"). */
  displayName: z.string().max(80).nullable(),
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
  sms: z.object({
    /** Which provider the appliance is configured to use. Null when the
     *  operator hasn't picked one — companies with their own SMS config
     *  still work; companies without one get no SMS. */
    provider: smsProviderEnum.nullable(),
    twilio: z.object({
      accountSid: z.string().nullable(),
      /** Auth token is never returned. Use this flag to tell whether one
       *  is configured. */
      authTokenHasSecret: z.boolean(),
      fromNumber: z.string().nullable(),
    }),
    textlinksms: z.object({
      apiKeyHasSecret: z.boolean(),
      fromNumber: z.string().nullable(),
      baseUrl: z.string().nullable(),
    }),
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
  /** Custom display name. `null` clears and reverts to the product
   *  default. Trimmed empty string is rejected — send null instead. */
  displayName: z.union([z.string().min(1).max(80), z.null()]).optional(),
  emailit: z
    .object({
      apiKey: z.union([z.string().min(1).max(512), z.null()]).optional(),
      fromEmail: z.union([z.string().email(), z.null()]).optional(),
      fromName: z.union([z.string().max(200), z.null()]).optional(),
      apiBaseUrl: z.union([z.string().url(), z.null()]).optional(),
    })
    .optional(),
  sms: z
    .object({
      provider: z.union([smsProviderEnum, z.null()]).optional(),
      twilio: z
        .object({
          accountSid: z.union([z.string().min(1).max(64), z.null()]).optional(),
          authToken: z.union([z.string().min(1).max(512), z.null()]).optional(),
          fromNumber: z.union([z.string().min(1).max(32), z.null()]).optional(),
        })
        .optional(),
      textlinksms: z
        .object({
          apiKey: z.union([z.string().min(1).max(512), z.null()]).optional(),
          fromNumber: z.union([z.string().min(1).max(32), z.null()]).optional(),
          baseUrl: z.union([z.string().url(), z.null()]).optional(),
        })
        .optional(),
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

// ---------------------------------------------------------------------------
// SuperAdmin diagnostic test sends
// ---------------------------------------------------------------------------

export const testEmailRequestSchema = z.object({
  to: z.string().email().max(320),
});
export type TestEmailRequest = z.infer<typeof testEmailRequestSchema>;

export const testSmsRequestSchema = z.object({
  /** E.164 formatted. We don't fully validate — Twilio/TextLinkSMS will
   *  reject a malformed number with a clear provider error. */
  to: z.string().min(5).max(32),
});
export type TestSmsRequest = z.infer<typeof testSmsRequestSchema>;

export const testSendResponseSchema = z.object({
  ok: z.boolean(),
  providerMessageId: z.string().nullable(),
  error: z.string().nullable(),
  provider: z.enum(['emailit', 'twilio', 'textlinksms']).nullable(),
});
export type TestSendResponse = z.infer<typeof testSendResponseSchema>;

// ---------------------------------------------------------------------------
// Public appliance info — no auth required (used by login page + magic-link
// consume page before anyone's authenticated)
// ---------------------------------------------------------------------------

export const applianceInfoSchema = z.object({
  displayName: z.string(),
});
export type ApplianceInfoResponse = z.infer<typeof applianceInfoSchema>;

// ---------------------------------------------------------------------------
// Cloudflare Tunnel — SuperAdmin-managed ingress sidecar
// ---------------------------------------------------------------------------

/** Machine-readable result of the host-side tunnel applier. */
export const tunnelApplyStateSchema = z.enum(['idle', 'queued', 'running', 'ok', 'failed']);
export type TunnelApplyState = z.infer<typeof tunnelApplyStateSchema>;

export const tunnelStatusSchema = z.object({
  /** Whether the cloudflare compose profile should run. The UI reads
   *  this to render the toggle; the host script reads it to decide
   *  `up` vs `down`. */
  enabled: z.boolean(),
  /** Whether any token has been set yet. We intentionally don't return
   *  the token itself — it exists only in `.env` on the host, never
   *  in the API response. */
  hasToken: z.boolean(),
  /** ISO timestamp of the last successful apply, or null if never. */
  lastAppliedAt: z.string().datetime().nullable(),
  /** Error string from the last apply if it failed, else null. */
  lastError: z.string().nullable(),
  /** Current apply state — reflects the status file dropped by the
   *  host script. Lets the UI show a "Applying…" spinner without
   *  polling docker directly. */
  applyState: tunnelApplyStateSchema,
  /** True if the host-side updater volume isn't wired — in that case
   *  PATCH returns 503. Lets the UI show "install the systemd units"
   *  instead of a generic error. */
  updaterWired: z.boolean(),
  /** True when the backend is running in development mode. The host
   *  systemd applier doesn't exist in dev, so requests queue forever.
   *  UI uses this to render a "dev mode" banner instead of the
   *  permanent "Waiting for host…" spinner. */
  devMode: z.boolean(),
});
export type TunnelStatusResponse = z.infer<typeof tunnelStatusSchema>;

export const updateTunnelRequestSchema = z
  .object({
    /** Flip the compose profile on or off. Omit to leave unchanged. */
    enabled: z.boolean().optional(),
    /** Set or rotate the tunnel token. Send a string to set, null to
     *  clear, or omit to leave the current token in place. */
    token: z.string().min(20).max(4096).nullable().optional(),
  })
  .refine(
    (v) => v.enabled !== undefined || v.token !== undefined,
    'At least one of `enabled` or `token` must be provided',
  );
export type UpdateTunnelRequest = z.infer<typeof updateTunnelRequestSchema>;
