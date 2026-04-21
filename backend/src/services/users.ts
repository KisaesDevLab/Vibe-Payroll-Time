import type { Knex } from 'knex';
import { db } from '../db/knex.js';

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role_global: 'super_admin' | 'none';
  /** Appliance-wide phone for user accounts (primarily SuperAdmins).
   *  Separate from `employees.phone` which is per-company and tied to
   *  the company's SMS provider. */
  phone: string | null;
  phone_verified_at: Date | null;
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

/**
 * Active SuperAdmins only — skips disabled rows. Used by UIs that need
 * to know whether someone is available to do super-admin work (e.g.
 * "add another SuperAdmin" warnings).
 */
export async function countSuperAdmins(trx?: Knex.Transaction): Promise<number> {
  const q = trx ?? db;
  const row = await q<UserRow>('users')
    .where({ role_global: 'super_admin' })
    .whereNull('disabled_at')
    .count<{ count: string }>('id as count')
    .first();
  return Number(row?.count ?? 0);
}

/**
 * Has a SuperAdmin EVER existed on this appliance, including disabled
 * ones. This is the right gate for "has first-run setup completed",
 * because disabling the only SuperAdmin must NOT reopen the setup
 * wizard — otherwise anyone on the network could hit `POST /setup/initial`
 * and mint themselves a new SuperAdmin. See docs/security.md.
 */
export async function anySuperAdminHasExisted(trx?: Knex.Transaction): Promise<boolean> {
  const q = trx ?? db;
  const row = await q<UserRow>('users')
    .where({ role_global: 'super_admin' })
    .count<{ count: string }>('id as count')
    .first();
  return Number(row?.count ?? 0) > 0;
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
  /** True if the user has an active `employees` row at this company.
   *  Distinct from `role === 'employee'` — a company_admin or
   *  supervisor membership says "this user has permissions here",
   *  while `isEmployee` says "this user also punches a clock here".
   *  The TopBar uses this to decide whether to show the "My time"
   *  link; the punch endpoints use the same predicate server-side. */
  isEmployee: boolean;
}

export async function listMemberships(userId: number): Promise<MembershipSummary[]> {
  const rows = await db('company_memberships as cm')
    .join('companies as c', 'c.id', 'cm.company_id')
    .leftJoin('employees as e', function () {
      this.on('e.user_id', '=', 'cm.user_id')
        .andOn('e.company_id', '=', 'cm.company_id')
        .andOnVal('e.status', '=', 'active');
    })
    .where('cm.user_id', userId)
    .whereNull('c.disabled_at')
    .select<
      Array<{
        company_id: number;
        company_name: string;
        company_slug: string;
        role: string;
        employee_id: number | null;
      }>
    >(
      'cm.company_id as company_id',
      'c.name as company_name',
      'c.slug as company_slug',
      'cm.role as role',
      'e.id as employee_id',
    );

  return rows.map((r) => ({
    companyId: r.company_id,
    companyName: r.company_name,
    companySlug: r.company_slug,
    role: r.role as MembershipSummary['role'],
    isEmployee: r.employee_id !== null,
  }));
}
