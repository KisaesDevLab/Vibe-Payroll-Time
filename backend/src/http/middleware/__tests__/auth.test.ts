// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { issueAccessToken } from '../../../services/tokens.js';
import { HttpError } from '../../errors.js';
import { requireAuth, setRevocationCheck } from '../auth.js';

/**
 * requireAuth's single sign-on revocation hook. Access tokens are
 * stateless, so an IdP back-channel logout can only take effect if every
 * verify consults the revocation list — this is that consult.
 */

const token = () =>
  issueAccessToken({ id: 7, email: 'someone@firm.test', roleGlobal: 'none' }).token;

async function run(authorization?: string): Promise<{ req: Request; err: unknown }> {
  const req = { headers: authorization ? { authorization } : {} } as Request;
  const next = vi.fn();
  await requireAuth(req, {} as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
  return { req, err: next.mock.calls[0]?.[0] };
}

describe('requireAuth', () => {
  afterEach(() => setRevocationCheck(null));

  it('accepts a valid token when no revocation check is wired', async () => {
    const { req, err } = await run(`Bearer ${token()}`);
    expect(err).toBeUndefined();
    expect(req.user).toMatchObject({ id: 7, email: 'someone@firm.test', authMethod: 'password' });
  });

  it('asks the revocation list about the token owner and its issue time', async () => {
    const check = vi.fn().mockResolvedValue(false);
    setRevocationCheck(check);
    const before = Math.floor(Date.now() / 1000) * 1000;

    const { err } = await run(`Bearer ${token()}`);

    expect(err).toBeUndefined();
    expect(check).toHaveBeenCalledTimes(1);
    const [key, issuedAtMs] = check.mock.calls[0]!;
    expect(key).toEqual({ userId: '7' });
    expect(issuedAtMs).toBeGreaterThanOrEqual(before);
    expect(issuedAtMs).toBeLessThanOrEqual(Date.now());
  });

  it('401s a revoked token and leaves req.user unset', async () => {
    setRevocationCheck(async () => true);
    const { req, err } = await run(`Bearer ${token()}`);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    expect(req.user).toBeUndefined();
  });

  it('never consults the list for a token that fails verification', async () => {
    const check = vi.fn().mockResolvedValue(false);
    setRevocationCheck(check);
    const { err } = await run('Bearer not-a-jwt');
    expect((err as HttpError).status).toBe(401);
    expect(check).not.toHaveBeenCalled();
  });

  it('passes a revocation-store failure to the error handler instead of letting the request through', async () => {
    setRevocationCheck(async () => {
      throw new Error('db down');
    });
    const { req, err } = await run(`Bearer ${token()}`);
    expect(err).toBeInstanceOf(Error);
    expect(req.user).toBeUndefined();
  });

  it('401s a missing bearer', async () => {
    expect(((await run()).err as HttpError).status).toBe(401);
  });
});
