import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_REMEMBER_TTL_SECONDS,
} from '@vibept/shared';
import { env } from '../config/env.js';
import { db } from '../db/knex.js';
import { Unauthorized } from '../http/errors.js';

export type AuthMethod = 'password' | 'magic_link';

export interface AccessTokenClaims {
  sub: string;
  email: string;
  roleGlobal: 'super_admin' | 'none';
  /** Which factor minted this session. Consumed by the "set new
   *  password without knowing the old one" flow: only magic-link
   *  sessions are allowed to skip the current-password check. */
  authMethod?: AuthMethod;
  /** Issued at (seconds). */
  iat?: number;
  /** Expiry (seconds). */
  exp?: number;
}

export function issueAccessToken(
  user: {
    id: number;
    email: string;
    roleGlobal: 'super_admin' | 'none';
  },
  opts: { authMethod?: AuthMethod } = {},
): { token: string; expiresAt: Date } {
  const expiresIn = ACCESS_TOKEN_TTL_SECONDS;
  const token = jwt.sign(
    {
      sub: String(user.id),
      email: user.email,
      roleGlobal: user.roleGlobal,
      authMethod: opts.authMethod ?? 'password',
    } satisfies AccessTokenClaims,
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn },
  );
  return { token, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as AccessTokenClaims;
  } catch {
    throw Unauthorized('Invalid or expired access token');
  }
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface IssueRefreshTokenInput {
  userId: number;
  remember?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

export async function issueRefreshToken(
  input: IssueRefreshTokenInput,
  trx?: Knex.Transaction,
): Promise<{ token: string; expiresAt: Date }> {
  const q = trx ?? db;
  const token = crypto.randomBytes(48).toString('base64url');
  const ttl = input.remember ? REFRESH_TOKEN_REMEMBER_TTL_SECONDS : REFRESH_TOKEN_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + ttl * 1000);

  await q('refresh_tokens').insert({
    user_id: input.userId,
    token_hash: sha256Hex(token),
    expires_at: expiresAt,
    ip: input.ip ?? null,
    user_agent: input.userAgent?.slice(0, 512) ?? null,
  });

  return { token, expiresAt };
}

/**
 * Atomically rotate a refresh token: verify the submitted token is still
 * live, mark it revoked, and issue a fresh token linked via `replaced_by_id`.
 * Returns the new tokens + the user's row so the caller can mint a fresh
 * access token without an extra query.
 */
export async function rotateRefreshToken(
  submittedToken: string,
  ctx: { ip?: string | null; userAgent?: string | null },
): Promise<{ token: string; expiresAt: Date; userId: number }> {
  return db.transaction(async (trx) => {
    const hash = sha256Hex(submittedToken);
    const existing = await trx('refresh_tokens')
      .where({ token_hash: hash })
      .forUpdate()
      .first<{ id: number; user_id: number; expires_at: Date; revoked_at: Date | null }>();

    if (!existing) throw Unauthorized('Invalid refresh token');
    if (existing.revoked_at) throw Unauthorized('Refresh token has been revoked');
    if (existing.expires_at.getTime() < Date.now()) throw Unauthorized('Refresh token expired');

    const { token, expiresAt } = await issueRefreshToken(
      { userId: existing.user_id, ip: ctx.ip, userAgent: ctx.userAgent },
      trx,
    );

    const newRow = await trx('refresh_tokens')
      .where({ token_hash: sha256Hex(token) })
      .first<{ id: number }>();

    await trx('refresh_tokens')
      .where({ id: existing.id })
      .update({ revoked_at: trx.fn.now(), replaced_by_id: newRow?.id ?? null });

    return { token, expiresAt, userId: existing.user_id };
  });
}

export async function revokeRefreshToken(submittedToken: string): Promise<void> {
  const hash = sha256Hex(submittedToken);
  await db('refresh_tokens')
    .where({ token_hash: hash })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });
}

export async function revokeAllForUser(userId: number): Promise<void> {
  await db('refresh_tokens')
    .where({ user_id: userId })
    .whereNull('revoked_at')
    .update({ revoked_at: db.fn.now() });
}
