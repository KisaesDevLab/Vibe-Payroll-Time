import { z } from 'zod';

// ---------------------------------------------------------------------------
// Time entry resource shape (used in every punch response + timesheet reads)
// ---------------------------------------------------------------------------

export const timeEntrySchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  employeeId: z.number().int().positive(),
  shiftId: z.string().uuid(),
  entryType: z.enum(['work', 'break']),
  jobId: z.number().int().positive().nullable(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int().nonnegative().nullable(),
  source: z.enum(['kiosk', 'web', 'mobile_pwa', 'web_manual']),
  sourceOffline: z.boolean(),
  /** Per-punch network attribution. Null for cron-closed entries and
   *  legacy rows pre-dating the column. Sensitive — only include in
   *  admin/supervisor-facing responses. */
  sourceIp: z.string().nullable(),
  sourceUserAgent: z.string().nullable(),
  approvedAt: z.string().datetime().nullable(),
  approvedBy: z.number().int().positive().nullable(),
  isAutoClosed: z.boolean(),
  /** Non-null on `web_manual` rows — the free-text reason the manual
   *  entry was created. */
  entryReason: z.string().nullable(),
  /** Non-null on punches that a later manual entry superseded. The row
   *  stays in the DB; only its "active" status changes. */
  supersededByEntryId: z.number().int().positive().nullable(),
  /** Non-null on manual entries — the punches they replaced. Used to
   *  restore on delete. */
  supersedesEntryIds: z.array(z.number().int().positive()).nullable(),
  /** Derived: `source === 'web_manual'`. Kept explicit so callers don't
   *  string-match. */
  isManual: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TimeEntry = z.infer<typeof timeEntrySchema>;

// ---------------------------------------------------------------------------
// Offline punch metadata — attached to any mutation that may have been
// queued on the client while disconnected. The server adjusts for clock
// skew; entries older than 72h are rejected.
// ---------------------------------------------------------------------------

const offlineMetaSchema = z.object({
  clientStartedAt: z.string().datetime().optional(),
  clientClockSkewMs: z.number().int().min(-86_400_000).max(86_400_000).optional(),
});

// ---------------------------------------------------------------------------
// Request bodies (user-auth variant always includes companyId; kiosk-auth
// variant omits it because the device context supplies the company)
// ---------------------------------------------------------------------------

export const clockInRequestSchema = offlineMetaSchema.extend({
  companyId: z.number().int().positive(),
  jobId: z.number().int().positive().nullable().optional(),
});
export type ClockInRequest = z.infer<typeof clockInRequestSchema>;

export const clockOutRequestSchema = offlineMetaSchema.extend({
  companyId: z.number().int().positive(),
});
export type ClockOutRequest = z.infer<typeof clockOutRequestSchema>;

export const breakInRequestSchema = clockOutRequestSchema;
export type BreakInRequest = z.infer<typeof breakInRequestSchema>;

export const breakOutRequestSchema = clockOutRequestSchema;
export type BreakOutRequest = z.infer<typeof breakOutRequestSchema>;

export const switchJobRequestSchema = offlineMetaSchema.extend({
  companyId: z.number().int().positive(),
  newJobId: z.number().int().positive(),
});
export type SwitchJobRequest = z.infer<typeof switchJobRequestSchema>;

// Kiosk variants — no companyId in the body (derived from device context).
export const kioskClockInRequestSchema = offlineMetaSchema.extend({
  jobId: z.number().int().positive().nullable().optional(),
});
export type KioskClockInRequest = z.infer<typeof kioskClockInRequestSchema>;

export const kioskPunchRequestSchema = offlineMetaSchema;
export type KioskPunchRequest = z.infer<typeof kioskPunchRequestSchema>;

export const kioskSwitchJobRequestSchema = offlineMetaSchema.extend({
  newJobId: z.number().int().positive(),
});
export type KioskSwitchJobRequest = z.infer<typeof kioskSwitchJobRequestSchema>;

// ---------------------------------------------------------------------------
// `GET /punch/current` response — current open entry + today's aggregates
// ---------------------------------------------------------------------------

export const currentPunchResponseSchema = z.object({
  employee: z.object({
    id: z.number().int().positive(),
    firstName: z.string(),
    lastName: z.string(),
  }),
  openEntry: timeEntrySchema.nullable(),
  /** Today's work-hours running total, in seconds, in the company TZ. */
  todayWorkSeconds: z.number().int().nonnegative(),
});
export type CurrentPunchResponse = z.infer<typeof currentPunchResponseSchema>;
