// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { db } from '../../db/knex.js';
import { HttpError } from '../../http/errors.js';
import { getVibeAuth } from './engine.js';
import { signInRealmForUser } from './realm.js';
import { policyIdentifierForEmail } from './users.js';

/**
 * The sign-in policy for EVERY local sign-in path — password, magic link,
 * password reset. Under `oidc_only` the firm has said "the identity
 * provider is the only door" — for the FIRM's users (./realm.ts). Two
 * exceptions:
 *
 *   - client-company admins, supervisors and employees are not the IdP's
 *     to gate: their password and link sign-ins work in every mode;
 *   - the break-glass account, by password only (its address is
 *     undeliverable, so it can never receive a link).
 *
 * Every check runs on a KNOWN user — after the password verified, or
 * against the user a link belongs to — so a refusal never tells an
 * anonymous caller which realm an address is in.
 *
 * A local path that skips this check is a hole in oidc_only.
 */

export const LOCAL_LOGIN_DISABLED = 'local_login_disabled';

const localLoginDisabled = (message: string) => new HttpError(403, LOCAL_LOGIN_DISABLED, message);

const FIRM_PASSWORD_MESSAGE =
  'Firm accounts sign in with single sign-on on this appliance, from the firm sign-in page (/firm).';
const FIRM_LINK_MESSAGE =
  'Firm accounts sign in with single sign-on on this appliance, so sign-in links are not available to them.';

/** True when the firm has switched this appliance to SSO only. The mode is
 *  already public (GET /auth/status). */
export function isOidcOnly(): boolean {
  return getVibeAuth().mode === 'oidc_only';
}

/** Password login, called once the password has verified: throws 403
 *  under oidc_only for a firm user other than break-glass. */
export async function assertLocalLoginAllowed(user: { id: number; email: string }): Promise<void> {
  if (getVibeAuth().localLoginAllowed(policyIdentifierForEmail(user.email)).allowed) return;
  if ((await signInRealmForUser(user.id)) === 'client') return;
  throw localLoginDisabled(FIRM_PASSWORD_MESSAGE);
}

/** May this user sign in with a magic link or reset link? Always, except a
 *  firm user under oidc_only. */
export async function linkSignInAllowedFor(userId: number): Promise<boolean> {
  if (!isOidcOnly()) return true;
  return (await signInRealmForUser(userId)) === 'client';
}

/** Consuming a link, or an admin sending one: throws 403 when the user
 *  could not use it. */
export async function assertLinkSignInAllowed(userId: number): Promise<void> {
  if (!(await linkSignInAllowedFor(userId))) throw localLoginDisabled(FIRM_LINK_MESSAGE);
}

/** Before an admin creates a brand-new login in `companyId` to send it a
 *  link: a new account's only tie is that company, so under oidc_only the
 *  firm's internal company is refused up front (nothing is provisioned). */
export async function assertNewLoginLinkAllowed(companyId: number): Promise<void> {
  if (!isOidcOnly()) return;
  const company = await db('companies')
    .where({ id: companyId })
    .first<{ is_internal: boolean } | undefined>('is_internal');
  if (company?.is_internal) throw localLoginDisabled(FIRM_LINK_MESSAGE);
}

/** Call after a successful local login so break-glass use is audited
 *  (`vibe.auth.breakglass.used`). The engine compares against the
 *  break-glass USERNAME, hence the mapping back from the address. */
export async function noteLocalLogin(
  user: { id: number; email: string },
  ip: string | null,
): Promise<void> {
  await getVibeAuth().afterLocalLogin({
    userId: String(user.id),
    username: policyIdentifierForEmail(user.email),
    ...(ip ? { ip } : {}),
  });
}
