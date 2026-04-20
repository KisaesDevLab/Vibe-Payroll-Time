import type { Knex } from 'knex';
import { db } from '../db/knex.js';

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role_global: 'super_admin' | 'none';
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  disabled_at: Date | null;
}

export async function findActiveUserByEmail(email: string): Promise<UserRow | undefined> {
  return db<UserRow>('users')
    .whereRaw('LOWER(email) = LOWER(?)', [email])
    .whereNull('disabled_at')
    .first();
}

export async function findUserById(id: number): Promise<UserRow | undefined> {
  return db<UserRow>('users').where({ id }).whereNull('disabled_at').first();
}

export async function countSuperAdmins(trx?: Knex.Transaction): Promise<number> {
  const q = trx ?? db;
  const row = await q<UserRow>('users')
    .where({ role_global: 'super_admin' })
    .whereNull('disabled_at')
    .count<{ count: string }>('id as count')
    .first();
  return Number(row?.count ?? 0);
}

export async function markLoginSuccess(userId: number): Promise<void> {
  await db('users').where({ id: userId }).update({
    last_login_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

export interface MembershipSummary {
  companyId: number;
  companyName: string;
  companySlug: string;
  role: 'company_admin' | 'supervisor' | 'employee';
}

export async function listMemberships(userId: number): Promise<MembershipSummary[]> {
  const rows = await db('company_memberships as cm')
    .join('companies as c', 'c.id', 'cm.company_id')
    .where('cm.user_id', userId)
    .whereNull('c.disabled_at')
    .select<
      Array<{ company_id: number; company_name: string; company_slug: string; role: string }>
    >('cm.company_id as company_id', 'c.name as company_name', 'c.slug as company_slug', 'cm.role as role');

  return rows.map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    companySlug: r.company_slug,
    role: r.role as MembershipSummary['role'],
  }));
}
