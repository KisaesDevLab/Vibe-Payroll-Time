// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Route-level tests for the admin-initiated "send a sign-in / password
 * reset link" endpoints. Drives the real Express app so auth,
 * requireCompanyRole, and zod validation are all in the path.
 *
 * The security property that matters most here is company scoping: a
 * CompanyAdmin at one company must not be able to mint a working
 * sign-in link for a user at another by guessing ids. That is a
 * full account takeover if it leaks, so it gets tested from both the
 * membership route and the employee route.
 *
 * Skipped when Postgres isn't reachable.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { createApp } from '../../http/app.js';
import { hashPassword } from '../passwords.js';
import { issueAccessToken } from '../tokens.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let baseUrl = '';
let server: { close: (cb?: () => void) => void };

let companyA = 0;
let companyB = 0;
let membershipEmpA = 0;
let membershipAdminB = 0;
/** Employee at A linked to a user account. */
let employeeLinked = 0;
/** Employee at A with an email but no user account (kiosk-only). */
let employeeUnlinked = 0;
/** Employee at A with neither email nor account. */
let employeeNoEmail = 0;
let employeeB = 0;
let adminAToken = '';
let adminBToken = '';
let supervisorAToken = '';

async function seed(): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE
       magic_links, auth_events, refresh_tokens, notifications_log,
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );

  const pw = await hashPassword('send-link-test-pw-12345');
  const mk = async (email: string) => {
    const [u] = await db('users')
      .insert({ email, password_hash: pw, role_global: 'none' })
      .returning<Array<{ id: number }>>('id');
    return Number(u!.id);
  };
  const adminA = await mk('admina@vibept.local');
  const supA = await mk('supa@vibept.local');
  const empA = await mk('empa@vibept.local');
  const adminB = await mk('adminb@vibept.local');

  const mkCo = async (name: string, slug: string) => {
    const [c] = await db('companies')
      .insert({
        name,
        slug,
        timezone: 'UTC',
        pay_period_type: 'bi_weekly',
        is_internal: true,
        license_state: 'internal_free',
      })
      .returning<Array<{ id: number }>>('id');
    return Number(c!.id);
  };
  companyA = await mkCo('Company A', 'send-link-a');
  companyB = await mkCo('Company B', 'send-link-b');

  await db('company_settings').insert([
    { company_id: companyA, allow_self_approve: true },
    { company_id: companyB, allow_self_approve: true },
  ]);

  const rows = await db('company_memberships')
    .insert([
      { user_id: adminA, company_id: companyA, role: 'company_admin' },
      { user_id: supA, company_id: companyA, role: 'supervisor' },
      { user_id: empA, company_id: companyA, role: 'employee' },
      { user_id: adminB, company_id: companyB, role: 'company_admin' },
    ])
    .returning<Array<{ id: number; user_id: number }>>(['id', 'user_id']);
  membershipEmpA = Number(rows.find((r) => Number(r.user_id) === empA)!.id);
  membershipAdminB = Number(rows.find((r) => Number(r.user_id) === adminB)!.id);

  const mkEmp = async (companyId: number, extra: Record<string, unknown>) => {
    const [e] = await db('employees')
      .insert({
        company_id: companyId,
        first_name: 'Test',
        last_name: 'Person',
        status: 'active',
        ...extra,
      })
      .returning<Array<{ id: number }>>('id');
    return Number(e!.id);
  };
  employeeLinked = await mkEmp(companyA, { user_id: empA, email: 'empa@vibept.local' });
  employeeUnlinked = await mkEmp(companyA, {
    email: 'newhire@vibept.local',
    phone: '+15555550123',
  });
  employeeNoEmail = await mkEmp(companyA, {});
  employeeB = await mkEmp(companyB, { email: 'bobb@vibept.local' });

  adminAToken = issueAccessToken({
    id: adminA,
    email: 'admina@vibept.local',
    roleGlobal: 'none',
  }).token;
  adminBToken = issueAccessToken({
    id: adminB,
    email: 'adminb@vibept.local',
    roleGlobal: 'none',
  }).token;
  supervisorAToken = issueAccessToken({
    id: supA,
    email: 'supa@vibept.local',
    roleGlobal: 'none',
  }).token;
}

/** Standard response envelope: `{ data }` on success, `{ error }` on
 *  failure. Accessors below keep assertions readable without an `any`. */
interface Envelope {
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string };
}

function data(r: { body: unknown }): Record<string, unknown> {
  return (r.body as Envelope).data ?? {};
}

function errorMessage(r: { body: unknown }): string {
  return (r.body as Envelope).error?.message ?? '';
}

async function api(
  path: string,
  opts: { method?: string; bearer?: string; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

describe.skipIf(!dbReachable)('send-link API', () => {
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

  beforeEach(seed);

  // -------------------------------------------------------------------
  // Auth + role
  // -------------------------------------------------------------------

  it('401s without a bearer token', async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      body: { channel: 'email', purpose: 'login' },
    });
    expect(r.status).toBe(401);
  });

  it('403s for a supervisor — sending credentials is admin-only', async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      bearer: supervisorAToken,
      body: { channel: 'email', purpose: 'login' },
    });
    expect(r.status).toBe(403);
    expect(await db('magic_links')).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Cross-company scoping — the takeover-grade property
  // -------------------------------------------------------------------

  it("refuses a membership id belonging to another company's user", async () => {
    // adminA is a legitimate company_admin at A, and membershipAdminB is
    // a real membership id — just not one at A. Must 404, not send.
    const r = await api(`/companies/${companyA}/memberships/${membershipAdminB}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'password_reset' },
    });
    expect(r.status).toBe(404);
    expect(await db('magic_links')).toHaveLength(0);
  });

  it('refuses an employee id belonging to another company', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeB}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'login', createLogin: true },
    });
    expect(r.status).toBe(404);
    expect(await db('magic_links')).toHaveLength(0);
    // And no account was provisioned for B's employee.
    const users = await db('users').where({ email: 'bobb@vibept.local' });
    expect(users).toHaveLength(0);
  });

  it("refuses when the admin isn't a member of the company at all", async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      bearer: adminBToken,
      body: { channel: 'email', purpose: 'login' },
    });
    expect(r.status).toBe(403);
    expect(await db('magic_links')).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Happy paths
  // -------------------------------------------------------------------

  it('sends a sign-in link for a member and reports a masked address', async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'login' },
    });
    expect(r.status).toBe(200);
    expect(data(r).purpose).toBe('login');
    expect(data(r).sentTo).not.toContain('empa@');
    expect(await db('magic_links')).toHaveLength(1);
  });

  it('sends a password reset for a member', async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'password_reset' },
    });
    expect(r.status).toBe(200);
    const rows = await db('magic_links');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.purpose).toBe('password_reset');
  });

  it('sends from the employee record when a login already exists', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeLinked}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'password_reset' },
    });
    expect(r.status).toBe(200);
    expect(data(r).loginCreated).toBe(false);
    expect(await db('magic_links')).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Provisioning a login from the employee record
  // -------------------------------------------------------------------

  it('refuses to provision a login unless createLogin is explicit', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeUnlinked}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'login' },
    });
    expect(r.status).toBe(400);
    expect(await db('users').where({ email: 'newhire@vibept.local' })).toHaveLength(0);
  });

  it('creates the login, links the employee row, and sends when asked', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeUnlinked}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'login', createLogin: true },
    });
    expect(r.status).toBe(200);
    expect(data(r).loginCreated).toBe(true);

    const [user] = await db('users').where({ email: 'newhire@vibept.local' });
    expect(user).toBeTruthy();

    // The employee row must now point at that user, otherwise the
    // person signs in and every /punch call 403s.
    const emp = await db('employees').where({ id: employeeUnlinked }).first();
    expect(Number(emp.user_id)).toBe(Number(user.id));

    // ...and they're a member of this company with the employee role.
    const membership = await db('company_memberships')
      .where({ user_id: user.id, company_id: companyA })
      .first();
    expect(membership.role).toBe('employee');
  });

  it('is idempotent about the account when both channels are used', async () => {
    for (const channel of ['email', 'sms']) {
      await api(`/companies/${companyA}/employees/${employeeUnlinked}/send-link`, {
        method: 'POST',
        bearer: adminAToken,
        body: { channel, purpose: 'login', createLogin: true },
      });
    }
    // Ticking both boxes on the create form must not make two accounts.
    expect(await db('users').where({ email: 'newhire@vibept.local' })).toHaveLength(1);
    expect(await db('magic_links')).toHaveLength(2);
  });

  it('refuses to provision a login for an employee with no email', async () => {
    const r = await api(`/companies/${companyA}/employees/${employeeNoEmail}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'login', createLogin: true },
    });
    expect(r.status).toBe(400);
    expect(errorMessage(r)).toMatch(/email address/i);
  });

  it('refuses to provision a login for a terminated employee', async () => {
    await db('employees').where({ id: employeeUnlinked }).update({ status: 'terminated' });
    const r = await api(`/companies/${companyA}/employees/${employeeUnlinked}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email', purpose: 'login', createLogin: true },
    });
    expect(r.status).toBe(400);
    expect(await db('users').where({ email: 'newhire@vibept.local' })).toHaveLength(0);
  });

  // -------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------

  it('rejects an unknown channel', async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'carrier-pigeon', purpose: 'login' },
    });
    expect(r.status).toBe(400);
  });

  it('defaults purpose to login when omitted', async () => {
    const r = await api(`/companies/${companyA}/memberships/${membershipEmpA}/send-link`, {
      method: 'POST',
      bearer: adminAToken,
      body: { channel: 'email' },
    });
    expect(r.status).toBe(200);
    expect(data(r).purpose).toBe('login');
  });
});
