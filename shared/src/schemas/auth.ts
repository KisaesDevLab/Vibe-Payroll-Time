// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

/** Shape of the authenticated user returned across auth endpoints. */
export const authUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  roleGlobal: z.enum(['super_admin', 'none']),
  memberships: z.array(
    z.object({
      companyId: z.number().int().positive(),
      companyName: z.string(),
      companySlug: z.string(),
      role: z.enum(['company_admin', 'supervisor', 'employee']),
      /** True when the user has an active `employees` row at this
       *  company — i.e. they punch a clock here, not just administer.
       *  Distinct from `role === 'employee'`: a supervisor who also
       *  tracks their own hours has both. UI uses this to decide
       *  whether to show the "My time" link. */
      isEmployee: z.boolean(),
    }),
  ),
});
export type AuthUser = z.infer<typeof authUserSchema>;

/** Login request (email + password). */
export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  rememberDevice: z.boolean().optional().default(false),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Successful auth response: tokens + user context. */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: z.string().datetime(),
  user: authUserSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Refresh token request. */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

/** Logout request — optional refresh token to revoke; if omitted, the
 *  currently-authenticated user's active refresh tokens are all revoked. */
export const logoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type LogoutRequest = z.infer<typeof logoutRequestSchema>;

/** Response from GET /auth/me. */
export const meResponseSchema = authUserSchema;
export type MeResponse = z.infer<typeof meResponseSchema>;

/** Change-password request for a signed-in user. Requires the current
 *  password even for SuperAdmins — this endpoint can't be used as a
 *  session-takeover weapon by someone with a stolen access token. */
export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Set a new password without knowing the current one. Only honored
 *  when the caller's session was minted via magic-link — the link
 *  was the ownership proof. */
export const setPasswordAfterMagicLinkRequestSchema = z.object({
  newPassword: z.string().min(12).max(256),
});
export type SetPasswordAfterMagicLinkRequest = z.infer<
  typeof setPasswordAfterMagicLinkRequestSchema
>;

/** Returned from GET /auth/me so the frontend can adjust the
 *  Preferences UI (e.g. show "Set new password" without a
 *  current-password field) when the session came from a magic link. */
export const authMethodSchema = z.enum(['password', 'magic_link']);
export type AuthMethod = z.infer<typeof authMethodSchema>;

// ---------------------------------------------------------------------------
// User-level (appliance-wide) phone management for /me endpoints
// ---------------------------------------------------------------------------

export const setUserPhoneRequestSchema = z.object({
  /** `null` clears the number and any verification state. */
  phone: z
    .string()
    .regex(/^\+?[0-9][0-9\s()\-.]{5,}$/, 'phone must include digits; prefix with + for E.164')
    .max(32)
    .nullable(),
});
export type SetUserPhoneRequest = z.infer<typeof setUserPhoneRequestSchema>;

export const confirmUserPhoneRequestSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'code must be 6 digits'),
});
export type ConfirmUserPhoneRequest = z.infer<typeof confirmUserPhoneRequestSchema>;

export const userPhoneStateSchema = z.object({
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  /** Appliance has an SMS provider set. Without one, sending a
   *  verification code is impossible — UI can disable the button. */
  smsAvailable: z.boolean(),
  pendingCodeExpiresAt: z.string().datetime().nullable(),
});
export type UserPhoneStateResponse = z.infer<typeof userPhoneStateSchema>;

// ---------------------------------------------------------------------------
// SuperAdmin cross-company users view
// ---------------------------------------------------------------------------

/** Summary of one membership for the admin users table. */
export const adminMembershipSchema = z.object({
  companyId: z.number().int().positive(),
  companyName: z.string(),
  companySlug: z.string(),
  isInternal: z.boolean(),
  role: z.enum(['company_admin', 'supervisor', 'employee']),
});
export type AdminMembership = z.infer<typeof adminMembershipSchema>;

export const adminUserSchema = z.object({
  id: z.number().int().positive(),
  email: z.string().email(),
  phone: z.string().nullable(),
  phoneVerified: z.boolean(),
  roleGlobal: z.enum(['super_admin', 'none']),
  disabled: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  memberships: z.array(adminMembershipSchema),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUsersResponseSchema = z.object({
  users: z.array(adminUserSchema),
  /** All companies on the appliance, so the bulk-edit drawer can
   *  render a row per company without a second fetch. */
  companies: z.array(
    z.object({
      id: z.number().int().positive(),
      name: z.string(),
      slug: z.string(),
      isInternal: z.boolean(),
    }),
  ),
});
export type AdminUsersResponse = z.infer<typeof adminUsersResponseSchema>;

/** Reconcile a user's memberships to match the desired set. The server
 *  diffs against current state: missing rows get inserted, extras get
 *  deleted, mismatched roles get updated. Atomic per user. */
export const bulkMembershipsRequestSchema = z.object({
  memberships: z.array(
    z.object({
      companyId: z.number().int().positive(),
      role: z.enum(['company_admin', 'supervisor', 'employee']),
    }),
  ),
});
export type BulkMembershipsRequest = z.infer<typeof bulkMembershipsRequestSchema>;

export const bulkMembershipsResponseSchema = z.object({
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  roleChanged: z.number().int().nonnegative(),
});
export type BulkMembershipsResponse = z.infer<typeof bulkMembershipsResponseSchema>;
