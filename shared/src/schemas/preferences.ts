// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

/** Accepts `'decimal'`, `'hhmm'`, or `null` (null = inherit from company
 *  default). */
export const updatePreferencesRequestSchema = z.object({
  timeFormatPreference: z.enum(['decimal', 'hhmm']).nullable(),
});
export type UpdatePreferencesRequest = z.infer<typeof updatePreferencesRequestSchema>;

export const userPreferencesResponseSchema = z.object({
  timeFormatPreference: z.enum(['decimal', 'hhmm']).nullable(),
  /** Resolved value the server will use for display — user preference
   *  if set, else company default. Returned for convenience so clients
   *  don't have to re-implement the resolver. */
  timeFormatEffective: z.enum(['decimal', 'hhmm']),
});
export type UserPreferencesResponse = z.infer<typeof userPreferencesResponseSchema>;
