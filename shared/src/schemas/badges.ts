import { z } from 'zod';

// ---------------------------------------------------------------------------
// Badge state on an employee row
// ---------------------------------------------------------------------------

export const employeeBadgeStateSchema = z.object({
  employeeId: z.number().int().positive(),
  /** 'none' — no badge ever issued.
   *  'active' — has been issued and not revoked; version matches current.
   *  'revoked' — explicitly revoked; physical badge should no longer scan. */
  state: z.enum(['none', 'active', 'revoked']),
  version: z.number().int().nonnegative(),
  issuedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type EmployeeBadgeState = z.infer<typeof employeeBadgeStateSchema>;

// ---------------------------------------------------------------------------
// Issue / reissue
// ---------------------------------------------------------------------------

/** Response from POST /employees/:id/badge/issue. The raw `payload` is the
 *  only time the appliance knows it — it exists on the printed badge after
 *  this. Dismissing the modal is non-recoverable; admin must reissue to
 *  get a new payload. */
export const issueBadgeResponseSchema = z.object({
  employeeId: z.number().int().positive(),
  payload: z.string(),
  version: z.number().int().positive(),
  issuedAt: z.string().datetime(),
  qrDataUrl: z.string(),
});
export type IssueBadgeResponse = z.infer<typeof issueBadgeResponseSchema>;

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

export const revokeBadgeRequestSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type RevokeBadgeRequest = z.infer<typeof revokeBadgeRequestSchema>;

// ---------------------------------------------------------------------------
// Kiosk scan (tablet-facing)
// ---------------------------------------------------------------------------

export const kioskScanRequestSchema = z.object({
  payload: z.string().min(16).max(512),
});
export type KioskScanRequest = z.infer<typeof kioskScanRequestSchema>;

// Scan success returns the same payload shape as PIN verify — the kiosk UI
// can hand it straight to the punch-action screen without branching on mode.

// ---------------------------------------------------------------------------
// Bulk issue
// ---------------------------------------------------------------------------

export const bulkIssueBadgesRequestSchema = z.object({
  employeeIds: z.array(z.number().int().positive()).min(1).max(500),
});
export type BulkIssueBadgesRequest = z.infer<typeof bulkIssueBadgesRequestSchema>;

export const bulkIssueBadgesResponseSchema = z.object({
  issued: z.array(
    z.object({
      employeeId: z.number().int().positive(),
      version: z.number().int().positive(),
      payload: z.string(),
    }),
  ),
  skipped: z.array(
    z.object({
      employeeId: z.number().int().positive(),
      reason: z.string(),
    }),
  ),
  /** Server-rendered HTML page, paginated for Avery 5392 or similar name
   *  badge stock. Admin uses the browser's Save-as-PDF dialog — same
   *  discipline as the timesheet PDF export in Phase 13. */
  printUrl: z.string(),
});
export type BulkIssueBadgesResponse = z.infer<typeof bulkIssueBadgesResponseSchema>;

// ---------------------------------------------------------------------------
// Badge events
// ---------------------------------------------------------------------------

export const badgeEventSchema = z.object({
  id: z.number().int().positive(),
  eventType: z.enum(['issue', 'revoke', 'scan_success', 'scan_failure']),
  employeeId: z.number().int().positive().nullable(),
  actorUserId: z.number().int().positive().nullable(),
  kioskDeviceId: z.number().int().positive().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type BadgeEvent = z.infer<typeof badgeEventSchema>;
