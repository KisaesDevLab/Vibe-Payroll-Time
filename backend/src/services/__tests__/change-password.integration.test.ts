// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * A password change signs out every OTHER session. The caller's own
 * refresh token, when it supplies one, survives — otherwise the person
 * who just changed their password would be silently signed out when
 * their access token expired 15 minutes later.
 *
 * Skipped when Postgres isn't reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { changePassword, setPasswordAfterMagicLink } from '../auth.js';
import { hashPassword } from '../passwords.js';
import { issueRefreshToken, rotateRefreshToken } from '../tokens.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

const OLD = 'old-password-123456';
const NEW = 'new-password-654321';
const ctx = { ip: null, userAgent: 'vitest' };
let userId = 0;
let otherUserId = 0;

async function seed() {
  await db.raw(`TRUNCATE TABLE refresh_tokens, auth_events, users RESTART IDENTITY CASCADE`);
  const hash = await hashPassword(OLD);
  const rows = await db('users')
    .insert([
      { email: 'me@acme.test', password_hash: hash, role_global: 'none' },
      { email: 'other@acme.test', password_hash: hash, role_global: 'none' },
    ])
    .returning<Array<{ id: number }>>('id');
  userId = rows[0]!.id;
  otherUserId = rows[1]!.id;
}

const rotates = (token: string) =>
  rotateRefreshToken(token, ctx).then(
    () => true,
    () => false,
  );

describe.skipIf(!dbReachable)('password change and sessions', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(seed);

  it('keeps the caller session and revokes the others', async () => {
    const mine = await issueRefreshToken({ userId });
    const laptop = await issueRefreshToken({ userId });
    const theirs = await issueRefreshToken({ userId: otherUserId });

    await changePassword(userId, OLD, NEW, ctx, mine.token);

    expect(await rotates(mine.token)).toBe(true);
    expect(await rotates(laptop.token)).toBe(false);
    // Another user's sessions are untouched.
    expect(await rotates(theirs.token)).toBe(true);
  });

  it('revokes every session when no token is supplied', async () => {
    const mine = await issueRefreshToken({ userId });
    await changePassword(userId, OLD, NEW, ctx);
    expect(await rotates(mine.token)).toBe(false);
  });

  it('a token belonging to someone else spares nothing', async () => {
    const mine = await issueRefreshToken({ userId });
    const theirs = await issueRefreshToken({ userId: otherUserId });
    await changePassword(userId, OLD, NEW, ctx, theirs.token);
    expect(await rotates(mine.token)).toBe(false);
  });

  it('set-password after a magic link keeps the caller session too', async () => {
    const mine = await issueRefreshToken({ userId });
    const phone = await issueRefreshToken({ userId });
    await setPasswordAfterMagicLink(userId, NEW, ctx, mine.token);
    expect(await rotates(mine.token)).toBe(true);
    expect(await rotates(phone.token)).toBe(false);
  });

  it('a wrong current password changes nothing', async () => {
    const laptop = await issueRefreshToken({ userId });
    await expect(changePassword(userId, 'wrong-password-000', NEW, ctx)).rejects.toThrow();
    expect(await rotates(laptop.token)).toBe(true);
  });
});
