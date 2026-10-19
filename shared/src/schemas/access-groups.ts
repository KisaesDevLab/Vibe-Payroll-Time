// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { z } from 'zod';

const companyRoleSchema = z.enum(['company_admin', 'supervisor', 'employee']);

/** A SuperAdmin-managed group that grants its members access to
 *  companies (backend/migrations/20261019000003_access_groups.js). */
export const accessGroupSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  members: z.array(z.object({ userId: z.number().int().positive(), email: z.string() })),
  companies: z.array(
    z.object({
      companyId: z.number().int().positive(),
      companyName: z.string(),
      isInternal: z.boolean(),
      role: companyRoleSchema,
    }),
  ),
  createdAt: z.string().datetime(),
});
export type AccessGroup = z.infer<typeof accessGroupSchema>;

export const createAccessGroupRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type CreateAccessGroupRequest = z.infer<typeof createAccessGroupRequestSchema>;

export const updateAccessGroupRequestSchema = createAccessGroupRequestSchema.partial();
export type UpdateAccessGroupRequest = z.infer<typeof updateAccessGroupRequestSchema>;

/** Replace a group's members with exactly this set. */
export const setAccessGroupMembersRequestSchema = z.object({
  userIds: z.array(z.number().int().positive()).max(2000),
});
export type SetAccessGroupMembersRequest = z.infer<typeof setAccessGroupMembersRequestSchema>;

/** Replace a group's company grants with exactly this set. */
export const setAccessGroupCompaniesRequestSchema = z.object({
  companies: z
    .array(z.object({ companyId: z.number().int().positive(), role: companyRoleSchema }))
    .max(500),
});
export type SetAccessGroupCompaniesRequest = z.infer<typeof setAccessGroupCompaniesRequestSchema>;
