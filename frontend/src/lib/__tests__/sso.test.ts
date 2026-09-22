// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../auth-store';
import {
  consumeSsoHandoff,
  decodeJwtClaims,
  isSsoSession,
  parseSsoFragment,
  takeSsoHandoffError,
} from '../sso';

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fakeJwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

describe('parseSsoFragment', () => {
  it('reads both tokens off the fragment', () => {
    expect(parseSsoFragment('#sso_token=aaa.bbb.ccc&sso_refresh=rrr')).toEqual({
      accessToken: 'aaa.bbb.ccc',
      refreshToken: 'rrr',
    });
  });

  it('url-decodes them', () => {
    const fragment = new URLSearchParams({ sso_token: 'a+b/c=', sso_refresh: 'r r' }).toString();
    expect(parseSsoFragment(`#${fragment}`)).toEqual({
      accessToken: 'a+b/c=',
      refreshToken: 'r r',
    });
  });

  it('needs BOTH — the session store cannot hold half a session', () => {
    expect(parseSsoFragment('#sso_token=aaa')).toBeNull();
    expect(parseSsoFragment('#sso_refresh=rrr')).toBeNull();
  });

  it('ignores an empty or unrelated fragment', () => {
    expect(parseSsoFragment('')).toBeNull();
    expect(parseSsoFragment('#')).toBeNull();
    expect(parseSsoFragment('#section-2')).toBeNull();
  });
});

describe('decodeJwtClaims', () => {
  it('decodes base64url payloads, including ones that need padding', () => {
    // Three payloads whose unpadded base64 lengths differ mod 4.
    for (const claims of [{ a: 1 }, { ab: 1 }, { sid: 'abc', exp: 1_900_000_000 }]) {
      expect(decodeJwtClaims(fakeJwt(claims))).toEqual(claims);
    }
  });

  it('returns null for anything that is not a JWT', () => {
    expect(decodeJwtClaims('')).toBeNull();
    expect(decodeJwtClaims('opaque-refresh-token')).toBeNull();
    expect(decodeJwtClaims('a.!!!.c')).toBeNull();
    expect(decodeJwtClaims(`a.${btoa('"just a string"')}.c`)).toBeNull();
  });
});

describe('consumeSsoHandoff', () => {
  const user = { id: 3, email: 'mia@firm.test', roleGlobal: 'none', memberships: [] };

  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.set(null);
    window.history.replaceState(null, '', '/');
  });

  function land(fragment: string, me: Response) {
    window.history.replaceState(null, '', `/login?x=1${fragment}`);
    const fetchMock = vi.fn().mockResolvedValue(me);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('turns the fragment into a stored session and scrubs it from the URL', async () => {
    const access = fakeJwt({ sub: '3', sid: 'deadbeef', exp: 1_900_000_000 });
    const fetchMock = land(
      `#sso_token=${access}&sso_refresh=rrr`,
      new Response(JSON.stringify({ data: user }), { status: 200 }),
    );

    await consumeSsoHandoff();

    // Gone from the address bar (and so from history and copied links)…
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?x=1');
    // …the user payload was fetched WITH the handed-off token…
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/v1\/auth\/me$/);
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe(
      `Bearer ${access}`,
    );
    // …and the store holds a complete session, shaped like any other login.
    expect(authStore.get()).toEqual({
      accessToken: access,
      refreshToken: 'rrr',
      accessTokenExpiresAt: new Date(1_900_000_000_000).toISOString(),
      user,
    });
    expect(takeSsoHandoffError()).toBeNull();
  });

  it('still scrubs the fragment, and stores nothing, when the token is refused', async () => {
    land(
      `#sso_token=${fakeJwt({ sub: '3' })}&sso_refresh=rrr`,
      new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'no' } }), {
        status: 401,
      }),
    );

    await consumeSsoHandoff();

    expect(window.location.hash).toBe('');
    expect(authStore.get()).toBeNull();
    expect(takeSsoHandoffError()).toMatch(/could not be loaded/);
    expect(takeSsoHandoffError()).toBeNull(); // shown once
  });

  it('does nothing — not even a request — without a hand-off', async () => {
    const fetchMock = land('', new Response('{}'));
    await consumeSsoHandoff();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('isSsoSession', () => {
  it('is true only for an access token carrying a sid claim', () => {
    expect(isSsoSession(fakeJwt({ sub: '1', sid: 'deadbeef' }))).toBe(true);
    expect(isSsoSession(fakeJwt({ sub: '1', authMethod: 'password' }))).toBe(false);
    expect(isSsoSession(undefined)).toBe(false);
    expect(isSsoSession('garbage')).toBe(false);
  });
});
