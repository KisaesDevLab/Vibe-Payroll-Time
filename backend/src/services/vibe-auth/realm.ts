// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { Knex } from 'knex';
import { db } from '../../db/knex.js';

/**
 * Who single sign-on is for. The identity provider is the FIRM's: its
 * SuperAdmins and the staff of its internal company (`is_internal`), who
 * sign in to reach the client companies they serve. Admins, supervisors
 * and employees of a client company are not in that directory and must
 * never flow through Vibe Auth — they sign in locally (password or link)
 * in every mode, `oidc_only` included.
 *
 *   firm   — role_global = super_admin, OR any tie (membership or active
 *            employee row) to an active internal company, OR no tie to
 *            any active company at all (nothing to sign in to yet; the
 *            stricter realm is the safe default).
 *   client — not a super_admin, tied only to active client companies.
 *
 * The kiosk realm (device token + PIN/badge) has no `users` row and is
 * neither.
 */
export type SignInRealm = 'firm' | 'client';

export async function signInRealmForUser(
  userId: number,
  q: Knex | Knex.Transaction = db,
): Promise<SignInRealm> {
  const user = await q('users')
    .where({ id: userId })
    .first<{ role_global: string } | undefined>('role_global');
  if (!user || user.role_global === 'super_admin') return 'firm';

  const companies = await q('companies as c')
    .whereNull('c.disabled_at')
    .where((b) => {
      b.whereExists(
        q('company_memberships as cm')
          .whereRaw('cm.company_id = c.id')
          .where('cm.user_id', userId)
          .select(q.raw('1')),
      ).orWhereExists(
        q('employees as e')
          .whereRaw('e.company_id = c.id')
          .where('e.user_id', userId)
          .where('e.status', 'active')
          .select(q.raw('1')),
      );
    })
    .select<Array<{ is_internal: boolean }>>('c.is_internal');

  if (companies.length === 0) return 'firm';
  return companies.some((c) => c.is_internal) ? 'firm' : 'client';
}

/**
 * Is the user tied (membership or active employee row) to `companyId`,
 * and is that an active CLIENT company? The test for honouring a firm
 * user's admin-sent link from that company under oidc_only.
 */
export async function isTiedToClientCompany(
  userId: number,
  companyId: number,
  q: Knex | Knex.Transaction = db,
): Promise<boolean> {
  const company = await q('companies')
    .where({ id: companyId })
    .whereNull('disabled_at')
    .first<{ is_internal: boolean } | undefined>('is_internal');
  if (!company || company.is_internal) return false;
  const membership = await q('company_memberships')
    .where({ user_id: userId, company_id: companyId })
    .first('id');
  if (membership) return true;
  const employee = await q('employees')
    .where({ user_id: userId, company_id: companyId, status: 'active' })
    .first('id');
  return !!employee;
}

/**
 * The internal company role sync and just-in-time provisioning write to.
 * Exactly one active internal company, or null (none, or more than one —
 * ambiguous, so memberships are assigned by hand). Never a client company:
 * the IdP's groups describe the firm's staff, not a client's.
 */
export async function firmCompanyId(q: Knex | Knex.Transaction = db): Promise<number | null> {
  const rows = await q('companies')
    .where({ is_internal: true })
    .whereNull('disabled_at')
    .orderBy('id', 'asc')
    .limit(2)
    .select<Array<{ id: number }>>('id');
  return rows.length === 1 ? rows[0]!.id : null;
}
