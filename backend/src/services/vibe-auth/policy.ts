// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { HttpError } from '../../http/errors.js';
import { getVibeAuth } from './engine.js';
import { policyIdentifierForEmail } from './users.js';

/**
 * The sign-in policy for EVERY local sign-in path — password, magic link,
 * password reset. Under `oidc_only` the firm has said "the identity
 * provider is the only door"; the one exception is the break-glass
 * account, and only by password (its address is undeliverable, so it can
 * never receive a link).
 *
 * A local path that skips this check is a hole in oidc_only.
 */

export const LOCAL_LOGIN_DISABLED = 'local_login_disabled';

const localLoginDisabled = () =>
  new HttpError(
    403,
    LOCAL_LOGIN_DISABLED,
    'Local sign-in is disabled on this appliance. Use single sign-on.',
  );

/** True when the firm has switched this appliance to SSO only. The mode is
 *  already public (GET /auth/status), so refusing out loud reveals nothing
 *  about any identifier. */
export function isOidcOnly(): boolean {
  return getVibeAuth().mode === 'oidc_only';
}

/** Password login: throws 403 under oidc_only unless it is the break-glass user. */
export function assertLocalLoginAllowed(email: string): void {
  if (!getVibeAuth().localLoginAllowed(policyIdentifierForEmail(email)).allowed) {
    throw localLoginDisabled();
  }
}

/** Magic links and password resets: refused for everyone under oidc_only. */
export function assertLinkSignInAllowed(): void {
  if (isOidcOnly()) throw localLoginDisabled();
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
