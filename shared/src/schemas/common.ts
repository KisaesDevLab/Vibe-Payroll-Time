// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

/** Envelope for error responses. */
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Envelope for success responses. */
export const successResponseSchema = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    data,
    meta: z.record(z.string(), z.unknown()).optional(),
  });

/** Health check payload. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  version: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Readiness check payload. */
export const readyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.enum(['ok', 'fail'])),
  timestamp: z.string(),
});
export type ReadyResponse = z.infer<typeof readyResponseSchema>;

/** Version endpoint payload. */
export const versionResponseSchema = z.object({
  version: z.string(),
  gitSha: z.string(),
  buildDate: z.string(),
});
export type VersionResponse = z.infer<typeof versionResponseSchema>;
