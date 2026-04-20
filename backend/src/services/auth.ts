import type { AuthResponse, AuthUser, LoginRequest } from '@vibept/shared';
import { Unauthorized } from '../http/errors.js';
import { recordAuthEvent } from './auth-events.js';
import { verifyPassword } from './passwords.js';
import { issueAccessToken, issueRefreshToken } from './tokens.js';
import { findActiveUserByEmail, listMemberships, markLoginSuccess, type UserRow } from './users.js';

interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

async function buildAuthUser(user: UserRow): Promise<AuthUser> {
  const memberships = await listMemberships(user.id);
  return {
    id: user.id,
    email: user.email,
    roleGlobal: user.role_global,
    memberships,
  };
}

async function mintSession(
  user: UserRow,
  remember: boolean,
  ctx: RequestContext,
): Promise<AuthResponse> {
  const access = issueAccessToken({
    id: user.id,
    email: user.email,
    roleGlobal: user.role_global,
  });
  const refresh = await issueRefreshToken({
    userId: user.id,
    remember,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    user: await buildAuthUser(user),
  };
}

/**
 * Authenticate a user by email + password. On success mints an access token
 * + refresh token and writes an `auth_events` success row. On failure writes
 * a `login_failure` event and throws 401 — caller surfaces a generic error
 * to the client so an attacker can't distinguish "unknown email" from
 * "wrong password".
 */
export async function loginWithPassword(
  body: LoginRequest,
  ctx: RequestContext,
): Promise<AuthResponse> {
  const user = await findActiveUserByEmail(body.email);

  if (!user) {
    await recordAuthEvent({
      eventType: 'login_failure',
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'unknown_email', email: body.email },
    });
    throw Unauthorized('Invalid email or password');
  }

  const ok = await verifyPassword(body.password, user.password_hash);
  if (!ok) {
    await recordAuthEvent({
      eventType: 'login_failure',
      userId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'bad_password' },
    });
    throw Unauthorized('Invalid email or password');
  }

  const session = await mintSession(user, body.rememberDevice ?? false, ctx);
  await markLoginSuccess(user.id);
  await recordAuthEvent({
    eventType: 'login_success',
    userId: user.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { remember: !!body.rememberDevice },
  });

  return session;
}

export { buildAuthUser };
