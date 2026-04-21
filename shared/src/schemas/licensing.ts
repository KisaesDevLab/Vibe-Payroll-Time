// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// License claims (the JSON payload of the portal-signed JWT)
// ---------------------------------------------------------------------------

export const licenseTierSchema = z.enum([
  'firm_unlimited_annual',
  'firm_capped_annual',
  'per_company_monthly',
  'evaluation',
]);
export type LicenseTier = z.infer<typeof licenseTierSchema>;

/**
 * What kisaes-license-portal signs. Claim names track the JWT "reg
 * claims" convention (exp/iat) plus Vibe-specific fields.
 */
export const licenseClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string(), // typically "vibept-appliance"
  /** Appliance the license is bound to. */
  appliance_id: z.string(),
  /** Company slug the license covers. */
  company_slug: z.string(),
  tier: licenseTierSchema,
  /** Seat cap (null = unlimited). */
  employee_count_cap: z.number().int().nullable().optional(),
  /** Client-company cap for firm tiers. */
  company_count_cap: z.number().int().nullable().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type LicenseClaims = z.infer<typeof licenseClaimsSchema>;

// ---------------------------------------------------------------------------
// Effective state exposed to the UI
// ---------------------------------------------------------------------------

export const licenseStateSchema = z.enum([
  'internal_free',
  'trial',
  'licensed',
  'grace',
  'expired',
]);
// LicenseState is already exported from ../enums.ts — not re-exported here.

export const licenseStatusSchema = z.object({
  state: licenseStateSchema,
  /** When the license / trial expires. */
  expiresAt: z.string().datetime().nullable(),
  /** Days until expiry (negative when already expired). */
  daysUntilExpiry: z.number().int().nullable(),
  /** Parsed claims; null for internal / trial / no-license-uploaded. */
  claims: licenseClaimsSchema.nullable(),
  /** True iff enforcement is currently active on this appliance. When
   *  false, the UI can still render a status banner but no mutation
   *  path is gated. */
  enforced: z.boolean(),
  /** Last successful portal heartbeat. */
  lastCheckedAt: z.string().datetime().nullable(),
});
export type LicenseStatus = z.infer<typeof licenseStatusSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const uploadLicenseRequestSchema = z.object({
  jwt: z.string().min(20).max(8192),
});
export type UploadLicenseRequest = z.infer<typeof uploadLicenseRequestSchema>;

export const markInternalRequestSchema = z.object({
  isInternal: z.boolean(),
});
export type MarkInternalRequest = z.infer<typeof markInternalRequestSchema>;
