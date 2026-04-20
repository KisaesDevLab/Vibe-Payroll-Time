import { z } from 'zod';

/** Login request (email + password). */
export const loginRequestSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(256),
  rememberDevice: z.boolean().optional().default(false),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Response envelope for a successful login. */
export const loginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: z.object({
    id: z.number().int().positive(),
    email: z.string().email(),
    roleGlobal: z.enum(['super_admin', 'none']),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Refresh token request. */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;
