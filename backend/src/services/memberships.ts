// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { CompanyRole, InviteMembershipRequest, Membership } from '@vibept/shared';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';
import { hashPassword } from './passwords.js';

interface MembershipRow {
  id: number;
  user_id: number;
  company_id: number;
  role: CompanyRole;
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
    >('m.id', 'm.user_id', 'm.company_id', 'm.role', 'm.created_at', 'u.email');
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
      if (!body.initialPassword) {
        throw BadRequest(
          'Email is new to the appliance — provide initialPassword to create the account',
        );
      }
      const [created] = await trx('users')
        .insert({
          email: body.email,
          password_hash: await hashPassword(body.initialPassword),
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
      .first<{ id: number }>();
    if (clash) throw Conflict('User is already a member of this company');

    const [inserted] = await trx('company_memberships')
      .insert({ user_id: user.id, company_id: companyId, role: body.role })
      .returning<Array<MembershipRow>>('*');
    if (!inserted) throw new Error('failed to create membership');

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
    .first<{ id: number }>();
  if (!existing) throw NotFound('Membership not found');

  await db('company_memberships').where({ id: membershipId }).update({ role });

  const rows = await db('company_memberships as m')
    .join('users as u', 'u.id', 'm.user_id')
    .where('m.id', membershipId)
    .select<
      MembershipRow[]
    >('m.id', 'm.user_id', 'm.company_id', 'm.role', 'm.created_at', 'u.email');
  const fresh = rows[0];
  if (!fresh) throw new Error('membership vanished after update');
  return rowToMembership(fresh);
}

export async function revokeMembership(companyId: number, membershipId: number): Promise<void> {
  const removed = await db('company_memberships')
    .where({ id: membershipId, company_id: companyId })
    .delete();
  if (removed === 0) throw NotFound('Membership not found');
}
