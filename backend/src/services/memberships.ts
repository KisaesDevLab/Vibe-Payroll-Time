// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import crypto from 'node:crypto';
import type { CompanyRole, InviteMembershipRequest, Membership } from '@vibept/shared';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';
import { reconcileGroupAccess } from './access-groups.js';
import { hashPassword } from './passwords.js';
import { healEmployeeLinksForUser } from './users.js';

interface MembershipRow {
  id: number;
  user_id: number;
  company_id: number;
  role: CompanyRole;
  granted_by_group: boolean;
  created_at: Date;
  email: string;
}

function rowToMembership(row: MembershipRow): Membership {
  return {
    id: row.id,
    userId: row.user_id,
    companyId: row.company_id,
    email: row.email,
    role: row.role,
    grantedByGroup: row.granted_by_group,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listMembershipsForCompany(companyId: number): Promise<Membership[]> {
  const rows = await db('company_memberships as m')
    .join('users as u', 'u.id', 'm.user_id')
    .where('m.company_id', companyId)
    .orderBy('m.created_at', 'asc')
    .select<
      MembershipRow[]
    >('m.id', 'm.user_id', 'm.company_id', 'm.role', 'm.granted_by_group', 'm.created_at', 'u.email');
  return rows.map(rowToMembership);
}

export async function inviteMembership(
  companyId: number,
  body: InviteMembershipRequest,
): Promise<Membership> {
  return db.transaction(async (trx) => {
    let user = await trx('users').whereRaw('LOWER(email) = LOWER(?)', [body.email]).first<{
      id: number;
      email: string;
      disabled_at: Date | null;
    }>();

    if (user?.disabled_at) throw Conflict('User is disabled');

    if (!user) {
      if (!body.initialPassword && !body.sendInvite) {
        throw BadRequest(
          'Email is new to the appliance — provide initialPassword, or set sendInvite to have them set their own via a sign-in link',
        );
      }
      // With sendInvite and no chosen password, hash 32 random bytes.
      // Nobody — not the admin, not us — ever learns this value; the
      // account is reachable only through a magic link or a password
      // reset, both of which prove control of the mailbox or phone.
      // Deliberately NOT a null/empty hash: `verifyPassword` must have
      // something real to fail against, so a blank submitted password
      // can't ever match.
      const initial = body.initialPassword ?? crypto.randomBytes(32).toString('base64url');
      const [created] = await trx('users')
        .insert({
          email: body.email,
          password_hash: await hashPassword(initial),
          role_global: 'none',
        })
        .returning<Array<{ id: number; email: string; disabled_at: Date | null }>>([
          'id',
          'email',
          'disabled_at',
        ]);
      if (!created) throw new Error('failed to create user');
      user = created;
    }

    const clash = await trx('company_memberships')
      .where({ user_id: user.id, company_id: companyId })
      .first<{ id: number; granted_by_group: boolean }>();
    if (clash?.granted_by_group) {
      throw Conflict(
        'This person already has access to this company through an access group. Change it on the Groups page.',
      );
    }
    if (clash) throw Conflict('User is already a member of this company');

    const [inserted] = await trx('company_memberships')
      .insert({ user_id: user.id, company_id: companyId, role: body.role })
      .returning<Array<MembershipRow>>('*');
    if (!inserted) throw new Error('failed to create membership');

    // Backfill any employees rows with a matching email that predate
    // this user account — the original symptom was "admin added a
    // person as a team member AND as an employee with the same email,
    // and the employee can't punch in" because the employee row was
    // created with `user_id = NULL`. Link them here so the inverse
    // create-order (employee first, then team member) also works.
    // Shared with loginWithPassword / consumeMagicLink /
    // reconcileMemberships via the same helper.
    await healEmployeeLinksForUser(user.id, user.email, trx);

    return rowToMembership({ ...inserted, email: user.email });
  });
}

export async function updateMembershipRole(
  companyId: number,
  membershipId: number,
  role: CompanyRole,
): Promise<Membership> {
  const existing = await db('company_memberships')
    .where({ id: membershipId, company_id: companyId })
    .first<{ id: number; granted_by_group: boolean }>();
  if (!existing) throw NotFound('Membership not found');
  if (existing.granted_by_group) throw groupManaged();

  await db('company_memberships').where({ id: membershipId }).update({ role });

  const rows = await db('company_memberships as m')
    .join('users as u', 'u.id', 'm.user_id')
    .where('m.id', membershipId)
    .select<
      MembershipRow[]
    >('m.id', 'm.user_id', 'm.company_id', 'm.role', 'm.granted_by_group', 'm.created_at', 'u.email');
  const fresh = rows[0];
  if (!fresh) throw new Error('membership vanished after update');
  return rowToMembership(fresh);
}

/** Group-granted access changes only by changing the group. */
function groupManaged() {
  return Conflict('This access comes from an access group. Change it on the Groups page.');
}

export async function revokeMembership(companyId: number, membershipId: number): Promise<void> {
  await db.transaction(async (trx) => {
    const row = await trx('company_memberships')
      .where({ id: membershipId, company_id: companyId })
      .first<{ user_id: number; granted_by_group: boolean }>();
    if (!row) throw NotFound('Membership not found');
    if (row.granted_by_group) throw groupManaged();
    await trx('company_memberships').where({ id: membershipId }).delete();
    // A direct membership may have been shadowing a group grant for this
    // company; with it gone, the group's access applies.
    await reconcileGroupAccess(trx, [row.user_id]);
  });
}
