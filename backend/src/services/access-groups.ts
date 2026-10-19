// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type {
  AccessGroup,
  CompanyRole,
  CreateAccessGroupRequest,
  SetAccessGroupCompaniesRequest,
  SetAccessGroupMembersRequest,
  UpdateAccessGroupRequest,
} from '@vibept/shared';
import type { Knex } from 'knex';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';
import { healEmployeeLinksForUser } from './users.js';

/**
 * Access groups — how a SuperAdmin decides which of the firm's staff can
 * reach which companies, without editing every person one by one.
 *
 * A group has members (users) and company grants (company + role). The
 * grants are MATERIALIZED into `company_memberships` as rows with
 * `granted_by_group = true`, so every authorization check in the product
 * keeps reading that one table. `reconcileGroupAccess` is the only writer
 * of those rows; call it for every user whose groups or grants changed.
 *
 * Rules:
 *   - Several groups granting the same company → the highest role wins.
 *   - A direct membership (granted_by_group = false) is never touched
 *     here and takes precedence for that company: remove it to let the
 *     groups decide.
 *   - Group-granted rows are read-only everywhere else (Team page,
 *     People page): they change only by changing the group.
 */

const ROLE_RANK: Record<CompanyRole, number> = { employee: 1, supervisor: 2, company_admin: 3 };

/** The membership a user's groups add up to, per company. */
async function desiredGroupAccess(
  trx: Knex.Transaction,
  userId: number,
): Promise<Map<number, CompanyRole>> {
  const rows = await trx('access_group_members as m')
    .join('access_group_companies as gc', 'gc.group_id', 'm.group_id')
    .where('m.user_id', userId)
    .select<Array<{ company_id: number; role: CompanyRole }>>('gc.company_id', 'gc.role');
  const out = new Map<number, CompanyRole>();
  for (const r of rows) {
    const have = out.get(r.company_id);
    if (!have || ROLE_RANK[r.role] > ROLE_RANK[have]) out.set(r.company_id, r.role);
  }
  return out;
}

/**
 * Bring each user's group-granted memberships in line with their groups:
 * insert what is missing, fix roles, delete what no group grants any more.
 * Direct memberships are left alone.
 */
export async function reconcileGroupAccess(
  trx: Knex.Transaction,
  userIds: Iterable<number>,
): Promise<void> {
  for (const userId of new Set(userIds)) {
    const desired = await desiredGroupAccess(trx, userId);
    const current = await trx('company_memberships')
      .where({ user_id: userId })
      .select<
        Array<{ id: number; company_id: number; role: CompanyRole; granted_by_group: boolean }>
      >('id', 'company_id', 'role', 'granted_by_group');

    let added = 0;
    for (const row of current) {
      if (!row.granted_by_group) continue;
      const want = desired.get(row.company_id);
      if (!want) {
        await trx('company_memberships').where({ id: row.id }).delete();
      } else if (want !== row.role) {
        await trx('company_memberships').where({ id: row.id }).update({ role: want });
      }
    }
    const held = new Set(current.map((r) => r.company_id));
    for (const [companyId, role] of desired) {
      if (held.has(companyId)) continue; // a direct membership wins
      await trx('company_memberships').insert({
        user_id: userId,
        company_id: companyId,
        role,
        granted_by_group: true,
      });
      added += 1;
    }
    if (added > 0) {
      const user = await trx('users').where({ id: userId }).first<{ email: string }>('email');
      if (user) await healEmployeeLinksForUser(userId, user.email, trx);
    }
  }
}

async function memberIds(trx: Knex.Transaction, groupId: number): Promise<number[]> {
  return trx('access_group_members').where({ group_id: groupId }).pluck('user_id');
}

async function requireGroup(trx: Knex | Knex.Transaction, groupId: number): Promise<void> {
  const row = await trx('access_groups').where({ id: groupId }).first('id');
  if (!row) throw NotFound('Group not found');
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505';
}

export async function listAccessGroups(): Promise<AccessGroup[]> {
  const groups = await db('access_groups')
    .orderBy('name', 'asc')
    .select<
      Array<{ id: number; name: string; description: string | null; created_at: Date }>
    >('id', 'name', 'description', 'created_at');
  const members = await db('access_group_members as m')
    .join('users as u', 'u.id', 'm.user_id')
    .orderBy('u.email', 'asc')
    .select<
      Array<{ group_id: number; user_id: number; email: string }>
    >('m.group_id', 'm.user_id', 'u.email');
  const companies = await db('access_group_companies as gc')
    .join('companies as c', 'c.id', 'gc.company_id')
    .orderBy('c.name', 'asc')
    .select<
      Array<{
        group_id: number;
        company_id: number;
        name: string;
        is_internal: boolean;
        role: CompanyRole;
      }>
    >('gc.group_id', 'gc.company_id', 'c.name', 'c.is_internal', 'gc.role');

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    members: members
      .filter((m) => m.group_id === g.id)
      .map((m) => ({ userId: m.user_id, email: m.email })),
    companies: companies
      .filter((c) => c.group_id === g.id)
      .map((c) => ({
        companyId: c.company_id,
        companyName: c.name,
        isInternal: c.is_internal,
        role: c.role,
      })),
    createdAt: g.created_at.toISOString(),
  }));
}

async function getAccessGroup(groupId: number): Promise<AccessGroup> {
  const group = (await listAccessGroups()).find((g) => g.id === groupId);
  if (!group) throw NotFound('Group not found');
  return group;
}

export async function createAccessGroup(body: CreateAccessGroupRequest): Promise<AccessGroup> {
  try {
    const [row] = await db('access_groups')
      .insert({ name: body.name, description: body.description ?? null })
      .returning<Array<{ id: number }>>('id');
    if (!row) throw new Error('failed to create group');
    return getAccessGroup(row.id);
  } catch (err) {
    if (isUniqueViolation(err)) throw Conflict(`A group named "${body.name}" already exists`);
    throw err;
  }
}

export async function updateAccessGroup(
  groupId: number,
  body: UpdateAccessGroupRequest,
): Promise<AccessGroup> {
  await requireGroup(db, groupId);
  const patch: Record<string, unknown> = { updated_at: db.fn.now() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  try {
    await db('access_groups').where({ id: groupId }).update(patch);
  } catch (err) {
    if (isUniqueViolation(err)) throw Conflict(`A group named "${body.name}" already exists`);
    throw err;
  }
  return getAccessGroup(groupId);
}

/** Deleting a group takes away the access it granted. */
export async function deleteAccessGroup(groupId: number): Promise<void> {
  await db.transaction(async (trx) => {
    await requireGroup(trx, groupId);
    const affected = await memberIds(trx, groupId);
    await trx('access_groups').where({ id: groupId }).delete();
    await reconcileGroupAccess(trx, affected);
  });
  logger.info({ groupId }, 'access group deleted');
}

export async function setAccessGroupMembers(
  groupId: number,
  body: SetAccessGroupMembersRequest,
): Promise<AccessGroup> {
  await db.transaction(async (trx) => {
    await requireGroup(trx, groupId);
    const wanted = [...new Set(body.userIds)];
    if (wanted.length > 0) {
      const found = await trx('users').whereIn('id', wanted).pluck('id');
      if (found.length !== wanted.length) throw BadRequest('One or more users do not exist');
    }
    const before = await memberIds(trx, groupId);
    await trx('access_group_members').where({ group_id: groupId }).delete();
    if (wanted.length > 0) {
      await trx('access_group_members').insert(
        wanted.map((userId) => ({ group_id: groupId, user_id: userId })),
      );
    }
    await reconcileGroupAccess(trx, [...before, ...wanted]);
  });
  return getAccessGroup(groupId);
}

export async function setAccessGroupCompanies(
  groupId: number,
  body: SetAccessGroupCompaniesRequest,
): Promise<AccessGroup> {
  await db.transaction(async (trx) => {
    await requireGroup(trx, groupId);
    const byCompany = new Map(body.companies.map((c) => [c.companyId, c.role]));
    if (byCompany.size > 0) {
      const found = await trx('companies')
        .whereIn('id', [...byCompany.keys()])
        .pluck('id');
      if (found.length !== byCompany.size) throw BadRequest('One or more companies do not exist');
    }
    await trx('access_group_companies').where({ group_id: groupId }).delete();
    if (byCompany.size > 0) {
      await trx('access_group_companies').insert(
        [...byCompany].map(([companyId, role]) => ({
          group_id: groupId,
          company_id: companyId,
          role,
        })),
      );
    }
    await reconcileGroupAccess(trx, await memberIds(trx, groupId));
  });
  return getAccessGroup(groupId);
}
