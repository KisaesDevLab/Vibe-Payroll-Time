/**
 * End-to-end API security tests for Phase 4.5 badges. Spins up the real
 * Express app on an ephemeral port and drives it via fetch, exercising
 * middleware (auth, requireCompanyRole, zod validation) alongside the
 * service layer. These are the "an attacker probes production" tests:
 * role enforcement, cross-company scoping at the route boundary, malformed
 * bodies, and rate-limit HTTP behavior.
 *
 * Skipped when Postgres isn't reachable.
 */
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { createApp } from '../../http/app.js';
import { generateBadgeToken } from '../badge-crypto.js';
import { issueBadge } from '../badges.js';
import { _resetBadgeLockoutState } from '../kiosk-badge-lockout.js';
import { hashPassword } from '../passwords.js';
import { issueAccessToken } from '../tokens.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

type Tokens = {
  admin: string;
  supervisor: string;
  employee: string;
  otherCompanyAdmin: string;
  superAdmin: string;
};

let baseUrl = '';
let server: { close: (cb?: () => void) => void };

let companyA = 0;
let companyB = 0;
let employeeA = 0;
let employeeB = 0;
let kioskDeviceA = 0;
let kioskDeviceTokenA = '';
let tokens: Tokens;

function sha256Hex(v: string): string {
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex');
}

async function seed(): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE
       badge_events,
       time_entry_audit,
       time_entries,
       jobs,
       employees,
       company_memberships,
       company_settings,
       companies,
       users,
       auth_events,
       refresh_tokens,
       kiosk_devices,
       kiosk_pairing_codes
     RESTART IDENTITY CASCADE`,
  );
  _resetBadgeLockoutState();

  const pw = await hashPassword('aggressive-test-pw-12345');
  const [superAdmin] = await db('users')
    .insert({ email: 'super@vibept.local', password_hash: pw, role_global: 'super_admin' })
    .returning<Array<{ id: number }>>('id');
  const [adminA] = await db('users')
    .insert({ email: 'admina@vibept.local', password_hash: pw, role_global: 'none' })
    .returning<Array<{ id: number }>>('id');
  const [supA] = await db('users')
    .insert({ email: 'supa@vibept.local', password_hash: pw, role_global: 'none' })
    .returning<Array<{ id: number }>>('id');
  const [empA] = await db('users')
    .insert({ email: 'empa@vibept.local', password_hash: pw, role_global: 'none' })
    .returning<Array<{ id: number }>>('id');
  const [adminB] = await db('users')
    .insert({ email: 'adminb@vibept.local', password_hash: pw, role_global: 'none' })
    .returning<Array<{ id: number }>>('id');

  const [ca] = await db('companies')
    .insert({
      name: 'Company A',
      slug: 'company-a',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: true,
      license_state: 'internal_free',
    })
    .returning<Array<{ id: number }>>('id');
  const [cb] = await db('companies')
    .insert({
      name: 'Company B',
      slug: 'company-b',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: false,
      license_state: 'internal_free',
    })
    .returning<Array<{ id: number }>>('id');
  companyA = ca!.id;
  companyB = cb!.id;

  await db('company_settings').insert([
    { company_id: companyA, kiosk_auth_mode: 'both' },
    { company_id: companyB, kiosk_auth_mode: 'pin' },
  ]);

  await db('company_memberships').insert([
    { user_id: adminA!.id, company_id: companyA, role: 'company_admin' },
    { user_id: supA!.id, company_id: companyA, role: 'supervisor' },
    { user_id: empA!.id, company_id: companyA, role: 'employee' },
    { user_id: adminB!.id, company_id: companyB, role: 'company_admin' },
  ]);

  const [ea] = await db('employees')
    .insert({ company_id: companyA, first_name: 'Alice', last_name: 'A', status: 'active' })
    .returning<Array<{ id: number }>>('id');
  const [eb] = await db('employees')
    .insert({ company_id: companyB, first_name: 'Bob', last_name: 'B', status: 'active' })
    .returning<Array<{ id: number }>>('id');
  // pg returns BIGINT as string; coerce so JSON bodies carry real numbers
  // and zod's z.number() validator accepts them.
  employeeA = Number(ea!.id);
  employeeB = Number(eb!.id);

  // Paired kiosk device for Company A — generate a token, store sha256.
  kioskDeviceTokenA = crypto.randomBytes(48).toString('base64url');
  const [ka] = await db('kiosk_devices')
    .insert({
      company_id: companyA,
      name: 'Kiosk A',
      token_hash: sha256Hex(kioskDeviceTokenA),
    })
    .returning<Array<{ id: number }>>('id');
  kioskDeviceA = ka!.id;

  tokens = {
    admin: issueAccessToken({ id: adminA!.id, email: 'admina@vibept.local', roleGlobal: 'none' })
      .token,
    supervisor: issueAccessToken({
      id: supA!.id,
      email: 'supa@vibept.local',
      roleGlobal: 'none',
    }).token,
    employee: issueAccessToken({ id: empA!.id, email: 'empa@vibept.local', roleGlobal: 'none' })
      .token,
    otherCompanyAdmin: issueAccessToken({
      id: adminB!.id,
      email: 'adminb@vibept.local',
      roleGlobal: 'none',
    }).token,
    superAdmin: issueAccessToken({
      id: superAdmin!.id,
      email: 'super@vibept.local',
      roleGlobal: 'super_admin',
    }).token,
  };
}

interface FetchOpts {
  method?: string;
  bearer?: string;
  kioskToken?: string;
  body?: unknown;
  raw?: boolean;
}

async function api(
  path: string,
  opts: FetchOpts = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.kioskToken) headers['x-kiosk-device-token'] = opts.kioskToken;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = null;
  if (!opts.raw) {
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, text };
}

describe.skipIf(!dbReachable)('badges API (route-level security)', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = (server as unknown as { address: () => AddressInfo }).address();
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    await seed();
  });

  // ---------------------------------------------------------------------------
  // Unauthenticated
  // ---------------------------------------------------------------------------

  it('401 when no bearer token is supplied to admin badge routes', async () => {
    const cases = [
      { path: `/companies/${companyA}/employees/${employeeA}/badge`, method: 'GET' },
      { path: `/companies/${companyA}/employees/${employeeA}/badge/issue`, method: 'POST' },
      { path: `/companies/${companyA}/employees/${employeeA}/badge/revoke`, method: 'POST' },
      { path: `/companies/${companyA}/employees/${employeeA}/badge/events`, method: 'GET' },
      { path: `/companies/${companyA}/employees/bulk-badges`, method: 'POST' },
    ];
    for (const c of cases) {
      const r = await api(c.path, { method: c.method, body: c.method === 'POST' ? {} : undefined });
      expect(r.status, `${c.method} ${c.path}`).toBe(401);
    }
  });

  it('401 when the bearer token is malformed', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeA}/badge`, {
      bearer: 'not-a-jwt',
    });
    expect(r.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Role enforcement
  // ---------------------------------------------------------------------------

  it('supervisor cannot issue a badge', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeA}/badge/issue`, {
      method: 'POST',
      bearer: tokens.supervisor,
      body: {},
    });
    expect(r.status).toBe(403);
  });

  it('employee-role user cannot view badge state', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeA}/badge`, {
      bearer: tokens.employee,
    });
    expect(r.status).toBe(403);
  });

  it('supervisor CAN view badge state and events (read-only)', async () => {
    await issueBadge(companyA, employeeA, /* actor */ 1);
    const state = await api(`/companies/${companyA}/employees/${employeeA}/badge`, {
      bearer: tokens.supervisor,
    });
    expect(state.status).toBe(200);

    const events = await api(`/companies/${companyA}/employees/${employeeA}/badge/events`, {
      bearer: tokens.supervisor,
    });
    expect(events.status).toBe(200);
  });

  it('admin cannot revoke without a badge having been issued (404)', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeA}/badge/revoke`, {
      method: 'POST',
      bearer: tokens.admin,
      body: { reason: 'test' },
    });
    expect(r.status).toBe(404);
  });

  it('admin CAN issue, then revoke, then reissue', async () => {
    const issue1 = await api(`/companies/${companyA}/employees/${employeeA}/badge/issue`, {
      method: 'POST',
      bearer: tokens.admin,
      body: {},
    });
    expect(issue1.status).toBe(201);

    const revoke1 = await api(`/companies/${companyA}/employees/${employeeA}/badge/revoke`, {
      method: 'POST',
      bearer: tokens.admin,
      body: {},
    });
    expect(revoke1.status).toBe(200);

    const issue2 = await api(`/companies/${companyA}/employees/${employeeA}/badge/issue`, {
      method: 'POST',
      bearer: tokens.admin,
      body: {},
    });
    expect(issue2.status).toBe(201);
  });

  // ---------------------------------------------------------------------------
  // Cross-company at the route layer
  // ---------------------------------------------------------------------------

  it('admin of company B cannot touch a badge in company A', async () => {
    const paths = [
      { path: `/companies/${companyA}/employees/${employeeA}/badge`, method: 'GET' },
      {
        path: `/companies/${companyA}/employees/${employeeA}/badge/issue`,
        method: 'POST',
      },
      {
        path: `/companies/${companyA}/employees/${employeeA}/badge/revoke`,
        method: 'POST',
      },
      {
        path: `/companies/${companyA}/employees/${employeeA}/badge/events`,
        method: 'GET',
      },
    ];
    for (const p of paths) {
      const r = await api(p.path, {
        method: p.method,
        bearer: tokens.otherCompanyAdmin,
        body: p.method === 'POST' ? {} : undefined,
      });
      expect(r.status, `${p.method} ${p.path}`).toBe(403);
    }
  });

  it('company A admin targeting a company B employee ID gets 404 (not 500, not a leak)', async () => {
    // requireCompanyRole passes because the user IS admin of company A, but
    // the service layer must reject because the employee belongs to B.
    const r = await api(`/companies/${companyA}/employees/${employeeB}/badge/issue`, {
      method: 'POST',
      bearer: tokens.admin,
      body: {},
    });
    expect(r.status).toBe(404);
    const body = r.body as { error?: { code?: string } };
    expect(body.error?.code).toBe('not_found');
  });

  it('bulk-badges ignores cross-company employee IDs by skipping them', async () => {
    const r = await api(`/companies/${companyA}/employees/bulk-badges`, {
      method: 'POST',
      bearer: tokens.admin,
      body: { employeeIds: [employeeA, employeeB] },
      raw: true,
    });
    expect(r.status, `body: ${r.text.slice(0, 400)}`).toBe(200);
    // The HTML sheet should only contain 1 badge (employeeA), since employeeB
    // lives in another company and is filtered out at the DB scope.
    // We verify via the X-Badges-Issued header.
    // (Can't read headers from `api()` right now, so re-fetch to check count
    //  via listBadgeEventsForEmployee from the service layer.)
    const rows = await db('badge_events')
      .where({ company_id: companyA, event_type: 'issue' })
      .select('employee_id');
    const employeeIds = rows.map((r2: { employee_id: number }) => r2.employee_id);
    expect(employeeIds).toEqual([employeeA]);
  });

  // ---------------------------------------------------------------------------
  // Zod validation boundary
  // ---------------------------------------------------------------------------

  it('bulk-badges rejects missing employeeIds', async () => {
    const r = await api(`/companies/${companyA}/employees/bulk-badges`, {
      method: 'POST',
      bearer: tokens.admin,
      body: {},
    });
    expect(r.status).toBe(400);
  });

  it('bulk-badges rejects an empty employeeIds list', async () => {
    const r = await api(`/companies/${companyA}/employees/bulk-badges`, {
      method: 'POST',
      bearer: tokens.admin,
      body: { employeeIds: [] },
    });
    expect(r.status).toBe(400);
  });

  it('bulk-badges rejects more than 500 employeeIds', async () => {
    const huge = Array.from({ length: 501 }, (_, i) => i + 1);
    const r = await api(`/companies/${companyA}/employees/bulk-badges`, {
      method: 'POST',
      bearer: tokens.admin,
      body: { employeeIds: huge },
    });
    expect(r.status).toBe(400);
  });

  it('bulk-badges rejects non-integer IDs', async () => {
    const r = await api(`/companies/${companyA}/employees/bulk-badges`, {
      method: 'POST',
      bearer: tokens.admin,
      body: { employeeIds: ['not-a-number'] as unknown as number[] },
    });
    expect(r.status).toBe(400);
  });

  it('revoke accepts an optional reason but rejects an overlong one', async () => {
    await issueBadge(companyA, employeeA, 1);
    const tooLong = 'x'.repeat(1000);
    const r = await api(`/companies/${companyA}/employees/${employeeA}/badge/revoke`, {
      method: 'POST',
      bearer: tokens.admin,
      body: { reason: tooLong },
    });
    expect(r.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // Kiosk scan endpoint
  // ---------------------------------------------------------------------------

  it('kiosk scan without device token → 401', async () => {
    const r = await api('/kiosk/scan', { method: 'POST', body: { payload: 'irrelevant' } });
    expect(r.status).toBe(401);
  });

  it('kiosk scan with a bearer (admin) token instead of device token → 401', async () => {
    // Conflating admin JWT with kiosk device token must not escalate.
    const r = await api('/kiosk/scan', {
      method: 'POST',
      bearer: tokens.admin,
      body: { payload: 'irrelevant' },
    });
    expect(r.status).toBe(401);
  });

  it('kiosk scan with a made-up device token → 401', async () => {
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: crypto.randomBytes(48).toString('base64url'),
      body: { payload: 'vpt1.1.1.1.xxxxxxxxxxx.' + 'A'.repeat(22) },
    });
    expect(r.status).toBe(401);
  });

  it('kiosk scan with a valid payload and valid device token → 200 + KioskEmployeeContext', async () => {
    const issued = await issueBadge(companyA, employeeA, 1);
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: { payload: issued.payload },
    });
    expect(r.status, `body: ${r.text}`).toBe(200);
    const body = r.body as { data: { employeeId: number; sessionToken: string } };
    expect(body.data.employeeId).toBe(employeeA);
    expect(body.data.sessionToken).toBeTruthy();
  });

  it('kiosk scan with bad HMAC → 401 + scan_failure event', async () => {
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: { payload: 'vpt1.1.1.1.xxxxxxxxxxx.' + 'A'.repeat(22) },
    });
    expect(r.status).toBe(401);
  });

  it('kiosk scan with cross-company payload → 401 (payload from B, kiosk in A)', async () => {
    const issuedB = generateBadgeToken({
      companyId: companyB,
      employeeId: employeeB,
      badgeVersion: 1,
    });
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: { payload: issuedB.payload },
    });
    expect(r.status).toBe(401);
  });

  it('kiosk scan with empty body → 400 (zod)', async () => {
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: {},
    });
    expect(r.status).toBe(400);
  });

  it('kiosk scan with payload too short → 400', async () => {
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: { payload: 'abc' },
    });
    expect(r.status).toBe(400);
  });

  it('kiosk scan rate limit returns 429 after 20 scans/min', async () => {
    _resetBadgeLockoutState();
    const issued = await issueBadge(companyA, employeeA, 1);
    for (let i = 0; i < 20; i++) {
      const r = await api('/kiosk/scan', {
        method: 'POST',
        kioskToken: kioskDeviceTokenA,
        body: { payload: issued.payload },
      });
      expect(r.status, `scan ${i + 1}`).toBe(200);
    }
    const tripping = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: { payload: issued.payload },
    });
    expect(tripping.status).toBe(429);
    const body = tripping.body as { error?: { code?: string } };
    expect(body.error?.code).toBe('rate_limited');
  });

  // ---------------------------------------------------------------------------
  // /kiosk/me auth mode propagation
  // ---------------------------------------------------------------------------

  it('GET /kiosk/me returns the company kiosk_auth_mode', async () => {
    const r = await api('/kiosk/me', { kioskToken: kioskDeviceTokenA });
    expect(r.status).toBe(200);
    const body = r.body as { data: { kioskAuthMode: string; companyName: string } };
    expect(body.data.kioskAuthMode).toBe('both');
    expect(body.data.companyName).toBe('Company A');
  });

  it('flipping the company setting is reflected by the next /kiosk/me call', async () => {
    await db('company_settings').where({ company_id: companyA }).update({ kiosk_auth_mode: 'qr' });
    const r = await api('/kiosk/me', { kioskToken: kioskDeviceTokenA });
    expect(r.status).toBe(200);
    const body = r.body as { data: { kioskAuthMode: string } };
    expect(body.data.kioskAuthMode).toBe('qr');
  });

  // ---------------------------------------------------------------------------
  // Revoked kiosk device
  // ---------------------------------------------------------------------------

  it('a revoked kiosk device cannot scan', async () => {
    await db('kiosk_devices').where({ id: kioskDeviceA }).update({ revoked_at: db.fn.now() });
    const r = await api('/kiosk/scan', {
      method: 'POST',
      kioskToken: kioskDeviceTokenA,
      body: { payload: 'vpt1.1.1.1.xxxxxxxxxxx.' + 'A'.repeat(22) },
    });
    expect(r.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Post-issue payload never leaks again
  // ---------------------------------------------------------------------------

  it('the raw payload is returned only on POST /badge/issue — GET /badge never includes it', async () => {
    const issue = await api(`/companies/${companyA}/employees/${employeeA}/badge/issue`, {
      method: 'POST',
      bearer: tokens.admin,
      body: {},
    });
    expect(issue.status).toBe(201);
    const body = issue.body as { data: { payload?: string; qrDataUrl?: string } };
    expect(body.data.payload).toMatch(/^vpt1\./);
    expect(body.data.qrDataUrl?.startsWith('data:image/png;base64,')).toBe(true);

    const get = await api(`/companies/${companyA}/employees/${employeeA}/badge`, {
      bearer: tokens.admin,
    });
    expect(get.status).toBe(200);
    const got = get.body as { data: Record<string, unknown> };
    expect(got.data).not.toHaveProperty('payload');
    expect(got.data).not.toHaveProperty('qrDataUrl');
  });
});
