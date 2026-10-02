// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Single sign-on (Vibe Auth) end to end: the real Express app, a real
 * Postgres, and an in-process fake OpenID Provider (./fake-idp.ts). Walks
 * every scenario the Vibe Auth integration plan names for a product's exit
 * gate, plus the ones specific to this product:
 *
 *   - the kiosk realm keeps working under oidc_only (it is not SSO's to gate)
 *   - group → role mapping lands on the two-layer role model correctly, in
 *     particular `vibe-partner` must NOT become an appliance super_admin
 *   - role sync cannot demote the last super_admin
 *   - an SSO-provisioned account cannot mail itself a local credential
 *   - accounts cannot be provisioned ahead of the first-run wizard
 *
 * The app is reached the way the appliance reaches it: the browser-facing
 * URL carries a `/time` prefix that the ingress strips, so every redirect
 * the engine hands "the browser" is un-prefixed here before it is followed.
 *
 * Skipped when Postgres isn't reachable.
 */
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  breakglassEnsure,
  breakglassStatus,
  breakglassVerify,
  makeAudit,
} from '@kisaesdevlab/vibe-auth';
import { BREAKGLASS_EMAIL, BREAKGLASS_USERNAME } from '@vibept/shared';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../../config/env.js';
import { db } from '../../../db/knex.js';
import { runMigrations } from '../../../db/migrate.js';
import { createApp } from '../../../http/app.js';
import { requestMagicLink } from '../../magic-links.js';
import { hashPassword } from '../../passwords.js';
import { issueAccessToken, type AccessTokenClaims } from '../../tokens.js';
import { _resetVibeAuth, startVibeAuth } from '../engine.js';
import { VIBE_PT_ADMIN_ROLE, createVibeUsers, vibeAuditSink } from '../users.js';
import { FakeIdp, type FakeIdpUser } from './fake-idp.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

const PREFIX = '/time';
const CLIENT_ID = 'vibe-payroll-test';
const CLIENT_SECRET = 'test-client-secret';
const PASSWORD = 'sso-integration-pw-12345';

let baseUrl = '';
let server: { close: (cb?: () => void) => void };
let idp: FakeIdp;
let companyId = 0;
let superAdminId = 0;
let kioskDeviceToken = '';
const originalTenantMode = env.TENANT_MODE;

/**
 * The auth rate limiter (10/min per client IP) covers the OIDC start and
 * callback steps, and this file alone would exhaust it. The app trusts one
 * proxy hop, so each test — and each browser flow — presents itself as a
 * different client.
 */
let clientSeq = 0;
let clientIp = '10.0.0.1';
function nextClient(): void {
  clientSeq += 1;
  clientIp = `10.0.${(clientSeq >> 8) & 255}.${clientSeq & 255}`;
}

const sha256Hex = (v: string) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

async function seed(): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE
       auth_sessions_oidc, auth_identities, auth_settings, auth_revocations,
       magic_links, auth_events, refresh_tokens, notifications_log,
       kiosk_devices, kiosk_pairing_codes,
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );

  const [su] = await db('users')
    .insert({
      email: 'owner@firm.test',
      password_hash: await hashPassword(PASSWORD),
      role_global: 'super_admin',
    })
    .returning<Array<{ id: number }>>('id');
  superAdminId = Number(su!.id);

  const [co] = await db('companies')
    .insert({
      name: 'The Firm',
      slug: 'the-firm',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: true,
      license_state: 'internal_free',
    })
    .returning<Array<{ id: number }>>('id');
  companyId = Number(co!.id);
  await db('company_settings').insert({ company_id: companyId, allow_self_approve: true });
  await db('company_memberships').insert({
    user_id: superAdminId,
    company_id: companyId,
    role: 'company_admin',
  });

  kioskDeviceToken = crypto.randomBytes(48).toString('base64url');
  await db('kiosk_devices').insert({
    company_id: companyId,
    name: 'Front desk',
    token_hash: sha256Hex(kioskDeviceToken),
  });
}

/** (Re)build the engine in a given mode, as a container restart would. */
async function configure(mode: 'local' | 'both' | 'oidc_only'): Promise<void> {
  process.env.VIBE_AUTH_MODE = mode;
  process.env.VIBE_OIDC_ISSUER = idp.issuer;
  process.env.VIBE_OIDC_CLIENT_ID = CLIENT_ID;
  process.env.VIBE_OIDC_CLIENT_SECRET = CLIENT_SECRET;
  process.env.VIBE_OIDC_PUBLIC_URL = `${baseUrl}${PREFIX}`;
  _resetVibeAuth();
  await startVibeAuth();
}

async function ensureBreakglass(): Promise<string> {
  const r = await breakglassEnsure({
    users: createVibeUsers(),
    audit: makeAudit(vibeAuditSink),
    username: BREAKGLASS_USERNAME,
    adminRole: VIBE_PT_ADMIN_ROLE,
    email: BREAKGLASS_EMAIL,
    actor: 'test',
  });
  if (!r.password) throw new Error('break-glass ensure returned no password');
  return r.password;
}

interface Res {
  status: number;
  location: string | null;
  text: string;
  json: unknown;
}

async function http(
  url: string,
  opts: {
    method?: string;
    bearer?: string;
    kioskToken?: string;
    body?: unknown;
    form?: string;
  } = {},
): Promise<Res> {
  const headers: Record<string, string> = { 'x-forwarded-for': clientIp };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.kioskToken) headers['x-kiosk-device-token'] = opts.kioskToken;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.form !== undefined) headers['content-type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    redirect: 'manual',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    ...(opts.form !== undefined ? { body: opts.form } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* an HTML page */
  }
  return { status: res.status, location: res.headers.get('location'), text, json };
}

const app = (path: string, opts?: Parameters<typeof http>[1]) => http(`${baseUrl}${path}`, opts);

/** What the ingress does: `<origin>/time/x` reaches the API as `/x`. */
function stripPrefix(browserUrl: string): string {
  const u = new URL(browserUrl, baseUrl);
  expect(u.pathname.startsWith(`${PREFIX}/`)).toBe(true);
  return `${baseUrl}${u.pathname.slice(PREFIX.length)}${u.search}`;
}

/** Drive the whole browser flow; returns the last response of the chain. */
async function ssoFlow(user: FakeIdpUser): Promise<Res> {
  nextClient();
  idp.user = user;
  const start = await app(`/auth/oidc/start?return_to=${encodeURIComponent(`${PREFIX}/login`)}`);
  expect(start.status).toBe(302);
  const authorize = await http(start.location!);
  expect(authorize.status).toBe(302);
  // The IdP sends the browser to the REGISTERED redirect URI, prefix and all.
  expect(authorize.location!.startsWith(`${baseUrl}${PREFIX}/auth/oidc/callback?`)).toBe(true);
  return http(stripPrefix(authorize.location!));
}

async function ssoLogin(
  user: FakeIdpUser,
): Promise<{ accessToken: string; refreshToken: string; claims: AccessTokenClaims }> {
  const cb = await ssoFlow(user);
  expect(cb.status).toBe(302);
  const [path, fragment] = cb.location!.split('#');
  expect(path).toBe(`${PREFIX}/login`);
  // The session rides the fragment, never the query string.
  expect(cb.location).not.toContain('?');
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('sso_token')!;
  const refreshToken = params.get('sso_refresh')!;
  expect(accessToken).toBeTruthy();
  expect(refreshToken).toBeTruthy();
  return { accessToken, refreshToken, claims: jwt.decode(accessToken) as AccessTokenClaims };
}

const person = (name: string, groups: string[], extra: Partial<FakeIdpUser> = {}): FakeIdpUser => ({
  sub: `sub-${name}`,
  email: `${name}@firm.test`,
  email_verified: true,
  name,
  groups,
  ...extra,
});

async function userRow(email: string) {
  return db('users').whereRaw('LOWER(email) = ?', [email]).first<{
    id: number;
    role_global: 'super_admin' | 'none';
    sso_provisioned_at: Date | null;
  }>();
}

const membershipsOf = (userId: number) =>
  db('company_memberships')
    .where({ user_id: userId })
    .select<Array<{ company_id: number; role: string }>>('company_id', 'role');

describe.skipIf(!dbReachable)('single sign-on (Vibe Auth)', () => {
  beforeAll(async () => {
    await (await import('../../__tests__/__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
    // The appliance runs single-tenant; role sync writes to "the" company.
    (env as { TENANT_MODE: string }).TENANT_MODE = 'single';
    idp = await new FakeIdp({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      user: person('nobody', []),
    }).start();
    await new Promise<void>((resolve) => {
      const s = createApp().listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
        resolve();
      });
      server = s;
    });
  });

  afterAll(async () => {
    (env as { TENANT_MODE: string }).TENANT_MODE = originalTenantMode;
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('VIBE_OIDC_') || k === 'VIBE_AUTH_MODE') delete process.env[k];
    }
    _resetVibeAuth();
    await idp?.stop();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await db.destroy();
  });

  beforeEach(async () => {
    nextClient();
    await seed();
  });

  // -------------------------------------------------------------------------
  describe('status', () => {
    it('local: SSO off, local login visible', async () => {
      await configure('local');
      const r = await app('/auth/status');
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({
        mode: 'local',
        product: 'vibe-payroll',
        localLoginVisible: true,
        oidc: { enabled: false },
      });
    });

    it('both: SSO on, and browser-facing paths carry the SPA prefix', async () => {
      await configure('both');
      const r = await app('/auth/status');
      expect(r.json).toMatchObject({
        mode: 'both',
        localLoginVisible: true,
        oidc: { enabled: true, startPath: `${PREFIX}/auth/oidc/start` },
      });
    });

    it('SSO start is refused while the mode is local', async () => {
      await configure('local');
      expect((await app('/auth/oidc/start')).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('sign-in', () => {
    beforeEach(() => configure('both'));

    it('provisions a new user just in time with the mapped company role', async () => {
      const { accessToken, claims } = await ssoLogin(person('mia', ['vibe-manager']));

      expect(claims.authMethod).toBe('sso');
      expect(claims.sid).toMatch(/^[0-9a-f]{32}$/);
      expect(claims.roleGlobal).toBe('none');

      const row = await userRow('mia@firm.test');
      expect(row?.role_global).toBe('none');
      expect(row?.sso_provisioned_at).not.toBeNull();
      // Exactly one membership, in the single company, with the mapped role.
      expect(await membershipsOf(row!.id)).toEqual([{ company_id: companyId, role: 'supervisor' }]);

      // The token is an ordinary session: the product's own API accepts it.
      const me = await app('/api/v1/auth/me', { bearer: accessToken });
      expect(me.status).toBe(200);
      expect(me.json).toMatchObject({
        data: { email: 'mia@firm.test', memberships: [{ role: 'supervisor' }] },
      });

      const events = await db('auth_events').where({ user_id: row!.id }).pluck('event_type');
      expect(events).toEqual(
        expect.arrayContaining(['vibe.auth.user.provisioned', 'vibe.auth.login.success']),
      );
    });

    it('maps vibe-partner to company_admin — never to appliance super_admin', async () => {
      const { claims } = await ssoLogin(person('pat', ['vibe-partner']));
      expect(claims.roleGlobal).toBe('none');
      const row = await userRow('pat@firm.test');
      expect(row?.role_global).toBe('none');
      expect(await membershipsOf(row!.id)).toEqual([
        { company_id: companyId, role: 'company_admin' },
      ]);
    });

    it('maps vibe-admin to super_admin', async () => {
      const { claims } = await ssoLogin(person('ada', ['vibe-admin']));
      expect(claims.roleGlobal).toBe('super_admin');
      expect((await userRow('ada@firm.test'))?.role_global).toBe('super_admin');
    });

    it('links an existing account by verified email and syncs its role', async () => {
      const [u] = await db('users')
        .insert({
          email: 'eve@firm.test',
          password_hash: await hashPassword(PASSWORD),
          role_global: 'none',
        })
        .returning<Array<{ id: number }>>('id');
      const eveId = Number(u!.id);
      await db('company_memberships').insert({
        user_id: eveId,
        company_id: companyId,
        role: 'employee',
      });

      await ssoLogin(person('eve', ['vibe-manager']));

      // Linked to the existing row — no second account for the same person.
      expect(await db('users')).toHaveLength(2);
      expect(await membershipsOf(eveId)).toEqual([{ company_id: companyId, role: 'supervisor' }]);
      // Linked, not provisioned: the account keeps its local password.
      expect((await userRow('eve@firm.test'))?.sso_provisioned_at).toBeNull();
      const events = await db('auth_events').where({ user_id: eveId }).pluck('event_type');
      expect(events).toEqual(
        expect.arrayContaining(['vibe.auth.user.linked', 'vibe.auth.role.changed']),
      );
    });

    it('role sync never demotes the last super_admin', async () => {
      // The owner signs in through the IdP, where they are merely "staff".
      const { claims } = await ssoLogin(person('owner', ['vibe-staff']));
      expect((await userRow('owner@firm.test'))?.role_global).toBe('super_admin');
      // …and the session reflects what was actually kept, not the mapped role.
      expect(claims.roleGlobal).toBe('super_admin');
      // The trail says the change was refused — never that it happened.
      const changes = await db('auth_events')
        .where({ user_id: superAdminId, event_type: 'vibe.auth.role.changed' })
        .pluck('metadata');
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({ refused: true, to: 'employee' });
    });

    it('setRole itself refuses the last super_admin, under its own lock', async () => {
      // The engine's countOtherActiveAdmins pre-check runs outside the
      // transaction; the adapter's re-check is the one that holds.
      const users = createVibeUsers();
      expect(await users.setRole(String(superAdminId), 'employee')).toBe(false);
      expect((await userRow('owner@firm.test'))?.role_global).toBe('super_admin');
      expect(await users.countOtherActiveAdmins!(String(superAdminId))).toBe(0);
    });

    it('role sync does demote a super_admin when another one remains', async () => {
      await db('users').insert({
        email: 'second@firm.test',
        password_hash: await hashPassword(PASSWORD),
        role_global: 'super_admin',
      });
      const { claims } = await ssoLogin(person('owner', ['vibe-staff']));
      expect(claims.roleGlobal).toBe('none');
      expect((await userRow('owner@firm.test'))?.role_global).toBe('none');
      expect(await membershipsOf(superAdminId)).toEqual([
        { company_id: companyId, role: 'employee' },
      ]);
    });

    it('the break-glass account does not count as "another super_admin"', async () => {
      await ensureBreakglass();
      await ssoLogin(person('owner', ['vibe-staff']));
      expect((await userRow('owner@firm.test'))?.role_global).toBe('super_admin');
    });

    it('refuses an unverified email', async () => {
      const cb = await ssoFlow(person('mallory', ['vibe-admin'], { email_verified: false }));
      expect(cb.status).toBe(401);
      expect(cb.text).toContain('did not confirm your email');
      expect(await userRow('mallory@firm.test')).toBeUndefined();
    });

    it('refuses a user in no mapped group', async () => {
      const cb = await ssoFlow(person('stranger', ['some-other-group']));
      expect(cb.status).toBe(401);
      expect(await userRow('stranger@firm.test')).toBeUndefined();
    });

    it('carries the SSO sid across refresh-token rotation', async () => {
      const first = await ssoLogin(person('mia', ['vibe-manager']));
      const r = await app('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: first.refreshToken },
      });
      expect(r.status).toBe(200);
      const next = (r.json as { data: { accessToken: string } }).data.accessToken;
      const claims = jwt.decode(next) as AccessTokenClaims;
      expect(claims.sid).toBe(first.claims.sid);
      expect(claims.authMethod).toBe('sso');
    });
  });

  // -------------------------------------------------------------------------
  describe('an SSO-provisioned account has no local credential', () => {
    beforeEach(() => configure('both'));

    it('self-service login and reset links skip it; ordinary accounts still get them', async () => {
      await ssoLogin(person('mia', ['vibe-manager']));
      const ask = (identifier: string) =>
        requestMagicLink({
          identifier,
          channel: 'email',
          origin: baseUrl,
          ip: null,
          userAgent: null,
        });

      await ask('mia@firm.test');
      expect(await db('magic_links').where({ identifier: 'mia@firm.test' })).toHaveLength(0);

      await ask('owner@firm.test');
      expect(await db('magic_links').where({ identifier: 'owner@firm.test' })).toHaveLength(1);
    });

    it('an SSO session cannot set a password without the current one', async () => {
      const { accessToken } = await ssoLogin(person('mia', ['vibe-manager']));
      const r = await app('/api/v1/auth/set-password', {
        method: 'POST',
        bearer: accessToken,
        body: { newPassword: 'a-brand-new-password-123' },
      });
      expect(r.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('settings API', () => {
    beforeEach(() => configure('both'));

    it('403 without a session and for a non-super-admin; 200 for a super_admin', async () => {
      expect((await app('/auth/settings')).status).toBe(403);

      const manager = await ssoLogin(person('mia', ['vibe-manager']));
      expect((await app('/auth/settings', { bearer: manager.accessToken })).status).toBe(403);

      const owner = issueAccessToken({
        id: superAdminId,
        email: 'owner@firm.test',
        roleGlobal: 'super_admin',
      }).token;
      const ok = await app('/auth/settings', { bearer: owner });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({
        mode: 'both',
        adminRole: 'super_admin',
        roles: ['super_admin', 'company_admin', 'supervisor', 'employee'],
        effective: {
          redirectUri: `${baseUrl}${PREFIX}/auth/oidc/callback`,
          roleMap: { 'vibe-partner': 'company_admin', 'vibe-manager': 'supervisor' },
        },
        breakglass: { username: BREAKGLASS_USERNAME, exists: false },
        guards: { canEnableOidcOnly: false },
      });
    });

    it('stores the client secret wrapped, never in the clear', async () => {
      const owner = issueAccessToken({
        id: superAdminId,
        email: 'owner@firm.test',
        roleGlobal: 'super_admin',
      }).token;
      const put = await app('/auth/settings', {
        method: 'PUT',
        bearer: owner,
        body: { clientSecret: 'a-very-secret-value' },
      });
      expect(put.status).toBe(200);
      const stored = JSON.stringify(await db('auth_settings').select('value'));
      expect(stored).not.toContain('a-very-secret-value');
      expect(stored).toContain('v1.'); // services/crypto.ts AES-GCM envelope
    });
  });

  // -------------------------------------------------------------------------
  describe('oidc_only', () => {
    it('refuses to boot without an active break-glass account', async () => {
      await expect(configure('oidc_only')).rejects.toThrow(/break-glass user/);
    });

    it('closes every local door except break-glass by password', async () => {
      const bgPassword = await ensureBreakglass();
      await configure('oidc_only');

      // Password login: an ordinary account is refused before any bcrypt work.
      const owner = await app('/api/v1/auth/login', {
        method: 'POST',
        body: { email: 'owner@firm.test', password: PASSWORD },
      });
      expect(owner.status).toBe(403);
      expect(owner.json).toMatchObject({ error: { code: 'local_login_disabled' } });

      // Links are local credentials too.
      for (const path of ['/api/v1/auth/magic/request', '/api/v1/auth/password-reset/request']) {
        const r = await app(path, {
          method: 'POST',
          body: { identifier: 'owner@firm.test', channel: 'email' },
        });
        expect(r.status).toBe(403);
      }
      const consume = await app('/api/v1/auth/magic/consume', {
        method: 'POST',
        body: { token: 'x'.repeat(43) },
      });
      expect(consume.status).toBe(403);

      // Break-glass signs in by the bare USERNAME the appliance prints…
      const byName = await app('/api/v1/auth/login', {
        method: 'POST',
        body: { email: BREAKGLASS_USERNAME, password: bgPassword },
      });
      expect(byName.status).toBe(200);
      expect(byName.json).toMatchObject({
        data: { user: { email: BREAKGLASS_EMAIL, roleGlobal: 'super_admin' } },
      });
      // …or by its address, and either way the use is audited.
      const byEmail = await app('/api/v1/auth/login', {
        method: 'POST',
        body: { email: BREAKGLASS_EMAIL, password: bgPassword },
      });
      expect(byEmail.status).toBe(200);
      const used = await db('auth_events').where({ event_type: 'vibe.auth.breakglass.used' });
      expect(used).toHaveLength(2);

      // A wrong password is still just a wrong password.
      const wrong = await app('/api/v1/auth/login', {
        method: 'POST',
        body: { email: BREAKGLASS_USERNAME, password: 'not-the-password-123' },
      });
      expect(wrong.status).toBe(401);

      // SSO itself keeps working.
      await ssoLogin(person('mia', ['vibe-manager']));
    });

    it('leaves the kiosk realm alone', async () => {
      await ensureBreakglass();
      await configure('oidc_only');
      const me = await app('/api/v1/kiosk/me', { kioskToken: kioskDeviceToken });
      expect(me.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('sign-out', () => {
    beforeEach(() => configure('both'));

    it('back-channel logout revokes the session; a fresh login is valid again', async () => {
      const mia = person('mia', ['vibe-manager']);
      const session = await ssoLogin(mia);
      expect((await app('/api/v1/auth/me', { bearer: session.accessToken })).status).toBe(200);

      // Token `iat` has one-second resolution and revocation is by moment.
      await new Promise((r) => setTimeout(r, 1100));
      const logout = await app('/auth/oidc/backchannel', {
        method: 'POST',
        form: new URLSearchParams({
          logout_token: await idp.logoutToken({ sub: mia.sub, sid: idp.sid }),
        }).toString(),
      });
      expect(logout.status).toBe(200);

      // The stateless access token dies on its next use…
      expect((await app('/api/v1/auth/me', { bearer: session.accessToken })).status).toBe(401);
      // …and the refresh token cannot rotate the session back in.
      const refresh = await app('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      });
      expect(refresh.status).toBe(401);
      expect(await db('auth_sessions_oidc')).toHaveLength(0);

      await new Promise((r) => setTimeout(r, 1100));
      const again = await ssoLogin(mia);
      expect((await app('/api/v1/auth/me', { bearer: again.accessToken })).status).toBe(200);
    });

    it('does not revoke other people', async () => {
      const mia = await ssoLogin(person('mia', ['vibe-manager']));
      const sam = person('sam', ['vibe-staff']);
      await ssoLogin(sam);
      await new Promise((r) => setTimeout(r, 1100));
      await app('/auth/oidc/backchannel', {
        method: 'POST',
        form: new URLSearchParams({
          logout_token: await idp.logoutToken({ sub: sam.sub }),
        }).toString(),
      });
      expect((await app('/api/v1/auth/me', { bearer: mia.accessToken })).status).toBe(200);
    });

    it('rejects a forged logout token', async () => {
      const forged = jwt.sign({ sub: 'sub-mia', events: {} }, 'not-the-idp-key');
      const r = await app('/auth/oidc/backchannel', {
        method: 'POST',
        form: new URLSearchParams({ logout_token: forged }).toString(),
      });
      expect(r.status).toBe(400);
    });

    it('user sign-out drops the identity row and the refresh chain behind it', async () => {
      const session = await ssoLogin(person('mia', ['vibe-manager']));
      expect(await db('auth_sessions_oidc')).toHaveLength(1);

      const out = await app('/auth/oidc/logout?local=1', { bearer: session.accessToken });
      expect(out.status).toBe(302);
      expect(out.location).toBe(`${PREFIX}/login`);

      expect(await db('auth_sessions_oidc')).toHaveLength(0);
      const refresh = await app('/api/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: session.refreshToken },
      });
      expect(refresh.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('break-glass status and verify (what the appliance asks)', () => {
    it('status reports an active, ready admin', async () => {
      await ensureBreakglass();
      const s = await breakglassStatus({
        users: createVibeUsers(),
        username: BREAKGLASS_USERNAME,
        adminRole: VIBE_PT_ADMIN_ROLE,
      });
      expect(s).toMatchObject({ exists: true, active: true, admin: true, ready: true });
      expect(s.problems).toEqual([]);
    });

    it('verify checks the stored password without counting as a sign-in', async () => {
      const bgPassword = await ensureBreakglass();
      const verify = (password: string) =>
        breakglassVerify({ users: createVibeUsers(), username: BREAKGLASS_USERNAME, password });

      expect(await verify(bgPassword)).toEqual({ exists: true, checked: true, matches: true });
      expect(await verify('not-the-password')).toEqual({
        exists: true,
        checked: true,
        matches: false,
      });
      const bg = await db('users')
        .whereRaw('LOWER(email) = ?', [BREAKGLASS_EMAIL])
        .first<{ id: number; last_login_at: Date | null }>('id', 'last_login_at');
      expect(bg?.last_login_at).toBeNull();
      expect(
        await db('auth_events')
          .where({ user_id: bg!.id })
          .whereIn('event_type', ['login_failure', 'login_success']),
      ).toHaveLength(0);
    });

    it('an SSO-provisioned account never verifies', async () => {
      await ssoLogin(person('jit', ['vibe-staff']));
      const row = await userRow('jit@firm.test');
      expect(await createVibeUsers().verifyLocalPassword!(String(row!.id), PASSWORD)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('first-run setup comes first', () => {
    it('refuses to provision any account into an appliance that has not been set up', async () => {
      // A pristine appliance: no super_admin has ever existed, no installation id.
      await db.raw('TRUNCATE TABLE users RESTART IDENTITY CASCADE');
      const settings = await db('appliance_settings').where({ id: 1 }).first('installation_id');
      await db('appliance_settings').where({ id: 1 }).update({ installation_id: 'pending-setup' });
      try {
        await expect(ensureBreakglass()).rejects.toThrow(/first-run setup/);
        expect(await db('users')).toHaveLength(0);
      } finally {
        await db('appliance_settings')
          .where({ id: 1 })
          .update({ installation_id: settings?.installation_id ?? 'pending-setup' });
      }
    });
  });
});
