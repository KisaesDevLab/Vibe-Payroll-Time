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
