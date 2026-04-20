import { describe, expect, it } from 'vitest';
import { issueAccessToken, verifyAccessToken } from '../tokens.js';
import { HttpError } from '../../http/errors.js';

describe('access tokens', () => {
  it('roundtrips claims through issue → verify', () => {
    const { token, expiresAt } = issueAccessToken({
      id: 42,
      email: 'k@kisaes.com',
      roleGlobal: 'super_admin',
    });
    expect(typeof token).toBe('string');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe('42');
    expect(claims.email).toBe('k@kisaes.com');
    expect(claims.roleGlobal).toBe('super_admin');
  });

  it('rejects tampered tokens', () => {
    const { token } = issueAccessToken({ id: 1, email: 'a@b.com', roleGlobal: 'none' });
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(() => verifyAccessToken(tampered)).toThrow(HttpError);
  });

  it('rejects garbage input', () => {
    expect(() => verifyAccessToken('nope')).toThrow(/expired|Invalid/i);
  });
});
