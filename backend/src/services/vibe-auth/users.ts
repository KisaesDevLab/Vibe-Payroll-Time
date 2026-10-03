// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import crypto from 'node:crypto';
import type {
  AuditSink,
  CreateLocalUserInput,
  CreateUserInput,
  UserAdapter,
  VibeUser,
} from '@kisaesdevlab/vibe-auth';
import { BREAKGLASS_EMAIL, BREAKGLASS_USERNAME, type CompanyRole } from '@vibept/shared';
import type { Knex } from 'knex';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/knex.js';
import { recordAuthEvent } from '../auth-events.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { anySuperAdminHasExisted, healEmployeeLinksForUser, type UserRow } from '../users.js';

/**
 * The two Vibe Auth adapters that only need the database: the UserAdapter
 * over `users` + `company_memberships`, and the audit sink over
 * `auth_events`. They live apart from ./engine.ts because the break-glass
 * CLI (src/vibeAuthAdapter.ts) loads them in a process with no Express.
 *
 * Roles. This product has two layers — `users.role_global`
 * (`super_admin | none`) and a per-company membership role — and the
 * package wants one slug per user. The vocabulary handed to it is
 *
 *     super_admin > company_admin > supervisor > employee
 *
 * where `super_admin` is role_global and the other three are the user's
 * membership. On the appliance TENANT_MODE=single, so "the membership" is
 * unambiguous: there is exactly one company, and role sync writes to it.
 * Under TENANT_MODE=multi the package cannot know which company an SSO
 * user belongs to, so sync only ever touches role_global there and an
 * admin assigns companies by hand (docs/sso.md).
 *
 * Only the staff realm is here. Kiosk employees (device token + PIN/badge)
 * have no `users` row and never meet this code.
 */

/** Most privileged first — the order the package resolves ties in. */
export const VIBE_PT_ROLES = ['super_admin', 'company_admin', 'supervisor', 'employee'] as const;
export const VIBE_PT_ADMIN_ROLE = 'super_admin';

/**
 * Explicit, never the package's default. Before 1.0.6 `defaultRoleMapFor`
 * guessed (every `vibe-partner` → `super_admin`, appliance-wide); it now
 * leaves unmapped groups unmapped, but `vibe-partner` and `vibe-manager`
 * only mean something here through this table.
 */
export const VIBE_PT_ROLE_MAP: Record<string, string> = {
  'vibe-admin': 'super_admin',
  'vibe-it': 'super_admin',
  'vibe-partner': 'company_admin',
  'vibe-manager': 'supervisor',
  'vibe-staff': 'employee',
};

const COMPANY_ROLES: readonly CompanyRole[] = ['company_admin', 'supervisor', 'employee'];

function isCompanyRole(role: string): role is CompanyRole {
  return (COMPANY_ROLES as readonly string[]).includes(role);
}

/** The login form admits the bare break-glass username; everything
 *  downstream of it works in email addresses. */
export function emailForLoginIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase() === BREAKGLASS_USERNAME ? BREAKGLASS_EMAIL : identifier;
}

/** The inverse, for the two engine hooks that compare against the
 *  break-glass USERNAME (`localLoginAllowed`, `afterLocalLogin`). */
export function policyIdentifierForEmail(email: string): string {
  return email.trim().toLowerCase() === BREAKGLASS_EMAIL ? BREAKGLASS_USERNAME : email;
}

function userId(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`vibe-auth: "${id}" is not a users id`);
  return n;
}

/** The user's most privileged membership across active companies. */
async function membershipRole(id: number): Promise<CompanyRole | null> {
  const rows = await db('company_memberships as cm')
    .join('companies as c', 'c.id', 'cm.company_id')
    .where('cm.user_id', id)
    .whereNull('c.disabled_at')
    .select<Array<{ role: CompanyRole }>>('cm.role');
  return COMPANY_ROLES.find((r) => rows.some((row) => row.role === r)) ?? null;
}

async function toVibeUser(row: UserRow): Promise<VibeUser> {
  const isBreakglass = row.email.toLowerCase() === BREAKGLASS_EMAIL;
  const role =
    row.role_global === 'super_admin' ? 'super_admin' : ((await membershipRole(row.id)) ?? '');
  return {
    id: String(row.id),
    email: row.email,
    // '' when the user holds no membership anywhere: no product role yet, so
    // the first SSO login's role sync assigns one.
    role,
    active: !row.disabled_at,
    local: !row.sso_provisioned_at,
    ...(isBreakglass ? { username: BREAKGLASS_USERNAME } : {}),
  };
}

/** The one company of a single-tenant appliance; null under TENANT_MODE=multi. */
async function singleCompanyId(q: Knex | Knex.Transaction): Promise<number | null> {
  if (env.TENANT_MODE !== 'single') return null;
  const row = await q('companies').whereNull('disabled_at').orderBy('id', 'asc').first<{
    id: number;
  }>('id');
  return row?.id ?? null;
}

async function upsertMembership(
  trx: Knex.Transaction,
  uid: number,
  companyId: number,
  role: CompanyRole,
): Promise<void> {
  await trx('company_memberships')
    .insert({ user_id: uid, company_id: companyId, role })
    .onConflict(['user_id', 'company_id'])
    .merge({ role });
}

/**
 * Account creation — just-in-time or break-glass — must not run before the
 * first-run wizard has. `POST /setup/initial` refuses for ever once any
 * super_admin row exists (docs/security.md), so a break-glass account
 * provisioned into an empty database would lock the operator out of setup
 * with no company to administer.
 */
async function assertSetupComplete(): Promise<void> {
  const settings = await db('appliance_settings')
    .where({ id: 1 })
    .first<{ installation_id: string | null }>();
  const stamped = !!settings?.installation_id && settings.installation_id !== 'pending-setup';
  if (stamped || (await anySuperAdminHasExisted())) return;
  throw new Error(
    'first-run setup has not been completed. Finish the /setup wizard, then retry ' +
      '(on the appliance: sudo vibe identity register vibe-payroll).',
  );
}

/**
 * Active super_admins other than `uid` that a person can actually sign in
 * as. The break-glass row does not count: it is an outage tool, not
 * somebody's account.
 */
async function countOtherSuperAdmins(q: Knex | Knex.Transaction, uid: number): Promise<number> {
  const row = await q('users')
    .where({ role_global: 'super_admin' })
    .whereNull('disabled_at')
    .whereNot({ id: uid })
    .whereRaw('LOWER(email) <> ?', [BREAKGLASS_EMAIL])
    .count<{ count: string }>('id as count')
    .first();
  return Number(row?.count ?? 0);
}

/** A bcrypt hash of random bytes nobody knows: satisfies NOT NULL (and
 *  varchar(72) — argon2id would not fit), can never be logged in with. */
async function unusablePasswordHash(): Promise<string> {
  return hashPassword(crypto.randomBytes(48).toString('base64url'));
}

export function createVibeUsers(): UserAdapter {
  return {
    async findById(id) {
      const n = Number(id);
      if (!Number.isInteger(n)) return null;
      const row = await db<UserRow>('users').where({ id: n }).first();
      return row ? toVibeUser(row) : null;
    },

    async findByEmail(email) {
      const row = await db<UserRow>('users')
        .whereRaw('LOWER(email) = ?', [email.trim().toLowerCase()])
        .first();
      return row ? toVibeUser(row) : null;
    },

    /** There are no usernames here. The only one the package ever asks
     *  for is the break-glass account's, which maps to a fixed address. */
    async findByUsername(username) {
      const email = emailForLoginIdentifier(username);
      if (!email.includes('@')) return null;
      return this.findByEmail(email);
    },

    /** Just-in-time provisioning from a verified IdP identity. */
    async create(input: CreateUserInput) {
      await assertSetupComplete();
      const email = input.email.trim().toLowerCase();
      const passwordHash = await unusablePasswordHash();

      const row = await db.transaction(async (trx) => {
        const [created] = await trx('users')
          .insert({
            email,
            password_hash: passwordHash,
            role_global: input.role === 'super_admin' ? 'super_admin' : 'none',
            sso_provisioned_at: trx.fn.now(),
          })
          .returning<UserRow[]>('*');
        if (!created) throw new Error('vibe-auth: failed to create user');

        const companyId = await singleCompanyId(trx);
        if (companyId) {
          // A super_admin gets the same company_admin membership the setup
          // wizard gives its own, so the company nav renders for them.
          const role = isCompanyRole(input.role) ? input.role : 'company_admin';
          await upsertMembership(trx, created.id, companyId, role);
        }
        // An employee record may already be waiting under this email.
        await healEmployeeLinksForUser(created.id, email, trx);
        return created;
      });

      return toVibeUser(row);
    },

    /** Lets the engine refuse a last-admin demotion before calling setRole. */
    async countOtherActiveAdmins(excludeUserId) {
      return countOtherSuperAdmins(db, userId(excludeUserId));
    },

    /** Returns false when the change is refused; the engine audits that. */
    async setRole(id, role) {
      const uid = userId(id);
      return db.transaction(async (trx) => {
        const user = await trx<UserRow>('users').where({ id: uid }).forUpdate().first();
        if (!user) throw new Error(`vibe-auth: user ${uid} not found`);

        if (role === 'super_admin') {
          await trx('users')
            .where({ id: uid })
            .update({ role_global: 'super_admin', updated_at: trx.fn.now() });
          return true;
        }
        if (!isCompanyRole(role)) throw new Error(`vibe-auth: "${role}" is not a role here`);

        if (user.role_global === 'super_admin') {
          // Role sync runs on the first SSO link of an EXISTING account. The
          // engine checks countOtherActiveAdmins first, but outside this
          // lock — this re-check is the authority: the IdP's group map must
          // never be able to leave the appliance without an administrator.
          if ((await countOtherSuperAdmins(trx, uid)) === 0) {
            logger.warn(
              { userId: uid, mappedRole: role },
              'vibe-auth: role sync would demote the last super_admin — refused',
            );
            return false;
          }
          await trx('users')
            .where({ id: uid })
            .update({ role_global: 'none', updated_at: trx.fn.now() });
        }

        const companyId = await singleCompanyId(trx);
        if (!companyId) return true; // TENANT_MODE=multi — companies are assigned by hand.
        await upsertMembership(trx, uid, companyId, role);
        await healEmployeeLinksForUser(uid, user.email, trx);
        return true;
      });
    },

    /** For `vibe-auth breakglass verify` only: does the Appliance's stored
     *  password still match this database (it won't after a restore)? A
     *  bare hash compare — no lockout counter, no last_login_at, no
     *  auth_events row. SSO-provisioned rows hold an unusable hash. */
    async verifyLocalPassword(id, password) {
      const row = await db<UserRow>('users')
        .where({ id: userId(id) })
        .first();
      if (!row || row.sso_provisioned_at) return false;
      return verifyPassword(password, row.password_hash);
    },

    /** Break-glass provisioning: an ACTIVE local super_admin with a real
     *  password and nothing that would stop a sign-in during an outage.
     *  Password only by design — no second factor exists in this product. */
    async createLocalUser(input: CreateLocalUserInput) {
      await assertSetupComplete();
      const [row] = await db('users')
        .insert({
          email: input.email.trim().toLowerCase(),
          password_hash: await hashPassword(input.password),
          role_global: input.role === 'super_admin' ? 'super_admin' : 'none',
        })
        .returning<UserRow[]>('*');
      if (!row) throw new Error('vibe-auth: failed to create the break-glass user');
      return toVibeUser(row);
    },

    async setLocalPassword(id, password) {
      await db('users')
        .where({ id: userId(id) })
        .update({
          password_hash: await hashPassword(password),
          sso_provisioned_at: null,
          updated_at: db.fn.now(),
        });
    },

    async setActive(id, active) {
      await db('users')
        .where({ id: userId(id) })
        .update({ disabled_at: active ? null : db.fn.now(), updated_at: db.fn.now() });
    },
  };
}

function numericId(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Every package event lands in auth_events — the same append-only trail
 * password and magic-link sign-ins already write to — with the event type
 * as-is (`vibe.auth.*`) and the payload as metadata. The package's audit
 * schema never carries tokens or secrets.
 */
export const vibeAuditSink: AuditSink = {
  async emit(event) {
    const { type, at, ip, ua, ...rest } = event;
    await recordAuthEvent({
      eventType: type,
      userId: numericId(rest.user_id) ?? numericId(rest.actor),
      ip: typeof ip === 'string' ? ip.slice(0, 64) : null,
      userAgent: typeof ua === 'string' ? ua : null,
      metadata: { ...rest, at },
    });
  },
};
