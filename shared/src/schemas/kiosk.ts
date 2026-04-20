import { z } from 'zod';

// ---------------------------------------------------------------------------
// Admin-facing (manage paired devices, issue pairing codes)
// ---------------------------------------------------------------------------

export const kioskDeviceSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  name: z.string(),
  pairedAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type KioskDevice = z.infer<typeof kioskDeviceSchema>;

export const createKioskPairingCodeRequestSchema = z.object({
  name: z.string().max(100).optional(),
});
export type CreateKioskPairingCodeRequest = z.infer<typeof createKioskPairingCodeRequestSchema>;

export const kioskPairingCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string().datetime(),
});
export type KioskPairingCodeResponse = z.infer<typeof kioskPairingCodeResponseSchema>;

export const renameKioskDeviceRequestSchema = z.object({
  name: z.string().min(1).max(100),
});
export type RenameKioskDeviceRequest = z.infer<typeof renameKioskDeviceRequestSchema>;

// ---------------------------------------------------------------------------
// Tablet-facing (pair, then verify PIN)
// ---------------------------------------------------------------------------

export const pairKioskRequestSchema = z.object({
  code: z.string().min(4).max(16),
  deviceName: z.string().min(1).max(100),
});
export type PairKioskRequest = z.infer<typeof pairKioskRequestSchema>;

export const pairKioskResponseSchema = z.object({
  deviceToken: z.string(),
  device: kioskDeviceSchema,
  companyName: z.string(),
});
export type PairKioskResponse = z.infer<typeof pairKioskResponseSchema>;

export const kioskVerifyPinRequestSchema = z.object({
  pin: z
    .string()
    .min(4)
    .max(6)
    .regex(/^\d+$/, 'PIN must be numeric'),
});
export type KioskVerifyPinRequest = z.infer<typeof kioskVerifyPinRequestSchema>;

/** Returned to the kiosk when a PIN resolves to an active employee. */
export const kioskEmployeeContextSchema = z.object({
  employeeId: z.number().int().positive(),
  firstName: z.string(),
  lastName: z.string(),
  /** Short-lived session token (~5 minutes) the kiosk uses to call punch
   *  endpoints for this PIN-verified employee. The kiosk discards it on
   *  confirmation screen timeout. */
  sessionToken: z.string(),
  /** Current open entry, if any, so the UI can render the right action. */
  openEntry: z
    .object({
      entryType: z.enum(['work', 'break']),
      startedAt: z.string().datetime(),
    })
    .nullable(),
  /** Today's work-hours running total in seconds. */
  todayWorkSeconds: z.number().int().nonnegative(),
});
export type KioskEmployeeContext = z.infer<typeof kioskEmployeeContextSchema>;
