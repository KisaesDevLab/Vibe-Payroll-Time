// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { Forbidden } from '../http/errors.js';

/**
 * The per-employee sign-in switch (`employees.login_disabled_at`).
 *
 * Switched off, the person keeps their employee record and can still
 * punch at a kiosk, but loses sign-in access to that company: every
 * company-scoped check treats the membership as absent, and the company
 * drops out of their session's membership list. When every company they
 * belong to is switched off, sign-in itself is refused (password, magic
 * link, single sign-on, and refresh). SuperAdmins are never affected.
 *
 * Every path that grants access to a company, or mints a session, must
 * go through here.
 */

export const LOGIN_DISABLED_MESSAGE =
  'Your sign-in has been turned off by your employer. You can still clock in and out at the kiosk.';

/** Companies where this user's employee record has sign-in switched off. */
export async function loginBlockedCompanyIds(
  userId: number,
  conn: Knex | Knex.Transaction = db,
): Promise<Set<number>> {
  const ids = await conn('employees')
    .where({ user_id: userId })
    .whereNotNull('login_disabled_at')
    .pluck('company_id');
  return new Set(ids.map(Number));
}

export async function isCompanyLoginBlocked(
  userId: number,
  companyId: number,
  conn: Knex | Knex.Transaction = db,
): Promise<boolean> {
  const row = await conn('employees')
    .where({ user_id: userId, company_id: companyId })
    .whereNotNull('login_disabled_at')
    .first<{ id: number }>('id');
  return !!row;
}

/**
 * Refuse to mint a session for someone whose every company has sign-in
 * switched off. A user with no memberships at all is left to the
 * existing flows (first-run, appliance staff); one with at least one
 * company still open signs in and simply doesn't see the closed ones.
 */
export async function assertSignInAllowed(
  user: { id: number; role_global: 'super_admin' | 'none' },
  conn: Knex | Knex.Transaction = db,
): Promise<void> {
  if (user.role_global === 'super_admin') return;
  const blocked = await loginBlockedCompanyIds(user.id, conn);
  if (blocked.size === 0) return;
  const companies = await conn('company_memberships as cm')
    .join('companies as c', 'c.id', 'cm.company_id')
    .where('cm.user_id', user.id)
    .whereNull('c.disabled_at')
    .pluck('cm.company_id');
  const open = companies.map(Number).filter((id) => !blocked.has(id));
  if (companies.length > 0 && open.length === 0) throw Forbidden(LOGIN_DISABLED_MESSAGE);
}
