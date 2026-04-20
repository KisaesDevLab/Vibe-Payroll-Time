import { z } from 'zod';

/** Optional client-side metadata carried on every punch. */
const clientMetaSchema = z.object({
  clientStartedAt: z.string().datetime().optional(),
  clientClockSkewMs: z.number().int().optional(),
});

export const clockInRequestSchema = clientMetaSchema.extend({
  employeeId: z.number().int().positive(),
  jobId: z.number().int().positive().optional(),
});
export type ClockInRequest = z.infer<typeof clockInRequestSchema>;

export const clockOutRequestSchema = clientMetaSchema.extend({
  employeeId: z.number().int().positive(),
});
export type ClockOutRequest = z.infer<typeof clockOutRequestSchema>;

export const breakInRequestSchema = clockOutRequestSchema;
export type BreakInRequest = z.infer<typeof breakInRequestSchema>;

export const breakOutRequestSchema = clockOutRequestSchema;
export type BreakOutRequest = z.infer<typeof breakOutRequestSchema>;

export const switchJobRequestSchema = clientMetaSchema.extend({
  employeeId: z.number().int().positive(),
  newJobId: z.number().int().positive(),
});
export type SwitchJobRequest = z.infer<typeof switchJobRequestSchema>;
