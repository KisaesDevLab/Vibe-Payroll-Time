// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AuthResponse, AuthUser, LoginRequest } from '@vibept/shared';
import { db } from '../db/knex.js';
import { BadRequest, NotFound, Unauthorized } from '../http/errors.js';
import { recordAuthEvent } from './auth-events.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { issueAccessToken, issueRefreshToken, revokeAllForUser } from './tokens.js';
import {
  findActiveUserByEmail,
  findUserById,
  healEmployeeLinksForUser,
  listMemberships,
  markLoginSuccess,
  type UserRow,
} from './users.js';

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

  // Self-heal any employees rows that match this user by email but
  // were inserted with user_id=NULL (older data, or a future path that
  // forgets the link). Runs before mintSession so the AuthUser payload
  // this login returns already reflects `isEmployee` correctly for any
  // newly-linked rows.
  await healEmployeeLinksForUser(user.id, user.email);

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

/**
 * Change a signed-in user's password. Always requires the current
 * password — an attacker with a stolen access token can't use this to
 * flip creds without also knowing the password.
 *
 * On success: writes the new bcrypt hash, revokes every refresh token
 * for the user so other sessions are forced to re-login, and records
 * a `password_change` auth event. The caller's current access token
 * stays valid until expiry (15 min) to keep this API a single call
 * instead of forcing the caller to re-login immediately.
 */
export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  ctx: RequestContext,
): Promise<void> {
  if (newPassword === currentPassword) {
    throw BadRequest('New password must differ from the current one');
  }

  const user = await findUserById(userId);
  if (!user) throw NotFound('User not found');

  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) {
    await recordAuthEvent({
      eventType: 'login_failure',
      userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reason: 'bad_password', context: 'change_password' },
    });
    throw Unauthorized('Current password does not match');
  }

  const newHash = await hashPassword(newPassword);
  await db('users').where({ id: userId }).update({
    password_hash: newHash,
    updated_at: db.fn.now(),
  });

  // Revoke other sessions — stale refresh tokens from the pre-change
  // state become unusable on their next rotation attempt.
  await revokeAllForUser(userId);

  await recordAuthEvent({
    eventType: 'password_change',
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

/**
 * Set a new password without requiring the current one. The route that
 * calls this gates on the session having been minted via magic-link,
 * so the caller has already proved ownership of the account's email
 * or phone within the last 15 minutes. Forgotten-password recovery
 * flow.
 */
export async function setPasswordAfterMagicLink(
  userId: number,
  newPassword: string,
  ctx: RequestContext,
): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw NotFound('User not found');

  const newHash = await hashPassword(newPassword);
  await db('users').where({ id: userId }).update({
    password_hash: newHash,
    updated_at: db.fn.now(),
  });

  await revokeAllForUser(userId);

  await recordAuthEvent({
    eventType: 'password_change',
    userId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { via: 'magic_link' },
  });
}

export { buildAuthUser };
