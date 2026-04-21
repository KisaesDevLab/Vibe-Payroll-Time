// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type {
  AdminMembership,
  AdminUser,
  AdminUsersResponse,
  BulkMembershipsRequest,
  BulkMembershipsResponse,
  CompanyRole,
} from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';

/**
 * SuperAdmin cross-company view of every user on the appliance and
 * bulk reconciliation of a single user's memberships against a
 * desired set. Scoped to SuperAdmin at the route layer.
 */

interface UserRow {
  id: number;
  email: string;
  phone: string | null;
  phone_verified_at: Date | null;
  role_global: 'super_admin' | 'none';
  disabled_at: Date | null;
  last_login_at: Date | null;
  created_at: Date;
}

interface MembershipRow {
  user_id: number;
  company_id: number;
  role: CompanyRole;
  name: string;
  slug: string;
  is_internal: boolean;
}

interface CompanyRow {
  id: number;
  name: string;
  slug: string;
  is_internal: boolean;
}

export async function listAdminUsers(): Promise<AdminUsersResponse> {
  const users = await db<UserRow>('users').orderBy('email', 'asc').select('*');
  const memberships = await db('company_memberships as m')
    .join('companies as c', 'c.id', 'm.company_id')
    .select<
      MembershipRow[]
    >('m.user_id', 'm.company_id', 'm.role', 'c.name', 'c.slug', 'c.is_internal');
  const companies = await db<CompanyRow>('companies').orderBy('name', 'asc').select('*');

  const byUser = new Map<number, AdminMembership[]>();
  for (const r of memberships) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push({
      companyId: r.company_id,
      companyName: r.name,
      companySlug: r.slug,
      isInternal: r.is_internal,
      role: r.role,
    });
    byUser.set(r.user_id, arr);
  }

  const out: AdminUser[] = users.map((u) => ({
    id: u.id,
    email: u.email,
    phone: u.phone,
    phoneVerified: !!u.phone_verified_at,
    roleGlobal: u.role_global,
    disabled: !!u.disabled_at,
    lastLoginAt: u.last_login_at?.toISOString() ?? null,
    createdAt: u.created_at.toISOString(),
    memberships: (byUser.get(u.id) ?? []).sort((a, b) =>
      a.companyName.localeCompare(b.companyName),
    ),
  }));

  return {
    users: out,
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      isInternal: c.is_internal,
    })),
  };
}

/**
 * Reconcile `company_memberships` for one user against a desired set.
 * Diffs against current state:
 *   - rows present in `desired` but missing in DB → INSERT
 *   - rows present in DB but missing from `desired` → DELETE
 *   - rows present in both with different `role` → UPDATE
 * All in a single transaction so a partial network failure can't
 * leave the user with a mix of old + new memberships.
 */
export async function reconcileMemberships(
  userId: number,
  body: BulkMembershipsRequest,
): Promise<BulkMembershipsResponse> {
  return db.transaction(async (trx) => {
    const user = await trx('users').where({ id: userId }).first<{ id: number }>();
    if (!user) throw NotFound('User not found');

    const current = await trx('company_memberships')
      .where({ user_id: userId })
      .select<
        Array<{ id: number; company_id: number; role: CompanyRole }>
      >('id', 'company_id', 'role');
    const byCompany = new Map(current.map((r) => [r.company_id, r]));
    const desiredByCompany = new Map(body.memberships.map((m) => [m.companyId, m]));

    let added = 0;
    let removed = 0;
    let roleChanged = 0;

    // Delete rows that are no longer desired.
    const toDelete: number[] = [];
    for (const row of current) {
      if (!desiredByCompany.has(row.company_id)) {
        toDelete.push(row.id);
      }
    }
    if (toDelete.length > 0) {
      removed = await trx('company_memberships').whereIn('id', toDelete).delete();
    }

    // Insert rows that are desired but not current; update rows with
    // a role mismatch. Done per-row so the counters stay accurate.
    for (const want of body.memberships) {
      const existing = byCompany.get(want.companyId);
      if (!existing) {
        await trx('company_memberships').insert({
          user_id: userId,
          company_id: want.companyId,
          role: want.role,
        });
        added += 1;
      } else if (existing.role !== want.role) {
        await trx('company_memberships').where({ id: existing.id }).update({ role: want.role });
        roleChanged += 1;
      }
    }

    return { added, removed, roleChanged };
  });
}
