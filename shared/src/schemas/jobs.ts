// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { z } from 'zod';

export const jobSchema = z.object({
  id: z.number().int().positive(),
  companyId: z.number().int().positive(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

export const createJobRequestSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});
export type CreateJobRequest = z.infer<typeof createJobRequestSchema>;

export const updateJobRequestSchema = createJobRequestSchema.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateJobRequest = z.infer<typeof updateJobRequestSchema>;
