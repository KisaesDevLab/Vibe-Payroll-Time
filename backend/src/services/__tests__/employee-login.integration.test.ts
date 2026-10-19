// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * The per-employee sign-in switch. Off at one company closes that
 * company to the person (membership list, company access, personal-
 * device punching) without touching their other companies; off at every
 * company refuses sign-in. Kiosk punching is not a login and keeps
 * working.
 *
 * Skipped when Postgres isn't reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { userCanAccessCompany } from '../companies.js';
import { assertSignInAllowed, isCompanyLoginBlocked } from '../employee-login.js';
import { setEmployeeLogin } from '../employees.js';
import { clockIn } from '../punch.js';
import { listMemberships } from '../users.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let adminId = 0;
let workerId = 0;
let acme = 0;
let bobs = 0;
let acmeEmployee = 0;

async function seed() {
  await db.raw(
    `TRUNCATE TABLE
       time_entry_audit, time_entries, employees, company_memberships,
       company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  const users = await db('users')
    .insert([
      { email: 'admin@acme.test', password_hash: 'x', role_global: 'none' },
      { email: 'worker@acme.test', password_hash: 'x', role_global: 'none' },
    ])
    .returning<Array<{ id: number }>>('id');
  adminId = users[0]!.id;
  workerId = users[1]!.id;
  const companies = await db('companies')
    .insert([
      { name: 'Acme', slug: 'acme', timezone: 'UTC', pay_period_type: 'weekly' },
      { name: "Bob's", slug: 'bobs', timezone: 'UTC', pay_period_type: 'weekly' },
    ])
    .returning<Array<{ id: number }>>('id');
  acme = companies[0]!.id;
  bobs = companies[1]!.id;
  await db('company_settings').insert([{ company_id: acme }, { company_id: bobs }]);
  await db('company_memberships').insert([
    { user_id: adminId, company_id: acme, role: 'company_admin' },
    { user_id: workerId, company_id: acme, role: 'employee' },
  ]);
  const rows = await db('employees')
    .insert([
      { company_id: acme, user_id: workerId, first_name: 'W', last_name: 'One', status: 'active' },
      { company_id: acme, user_id: adminId, first_name: 'A', last_name: 'Dmin', status: 'active' },
    ])
    .returning<Array<{ id: number }>>('id');
  acmeEmployee = rows[0]!.id;
}

const worker = () => ({ id: workerId, role_global: 'none' as const });

describe.skipIf(!dbReachable)('employee sign-in switch', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(seed);

  it('off closes the company and refuses sign-in when it was the only one', async () => {
    const e = await setEmployeeLogin(acme, acmeEmployee, false, adminId);
    expect(e.loginEnabled).toBe(false);
    expect(await isCompanyLoginBlocked(workerId, acme)).toBe(true);
    expect(await listMemberships(workerId)).toEqual([]);
    expect(await userCanAccessCompany(workerId, acme, 'none')).toBe(false);
    await expect(assertSignInAllowed(worker())).rejects.toThrow(/turned off/);

    await setEmployeeLogin(acme, acmeEmployee, true, adminId);
    await expect(assertSignInAllowed(worker())).resolves.toBeUndefined();
    expect((await listMemberships(workerId)).map((m) => m.companyId)).toEqual([acme]);
  });

  it('leaves the person their other companies', async () => {
    await db('company_memberships').insert({
      user_id: workerId,
      company_id: bobs,
      role: 'employee',
    });
    await db('employees').insert({
      company_id: bobs,
      user_id: workerId,
      first_name: 'W',
      last_name: 'One',
      status: 'active',
    });
    await setEmployeeLogin(acme, acmeEmployee, false, adminId);
    await expect(assertSignInAllowed(worker())).resolves.toBeUndefined();
    expect((await listMemberships(workerId)).map((m) => m.companyId)).toEqual([bobs]);
    expect(await userCanAccessCompany(workerId, bobs, 'none')).toBe(true);
  });

  it('refuses an admin switching off their own sign-in', async () => {
    const own = await db('employees').where({ company_id: acme, user_id: adminId }).first();
    await expect(setEmployeeLogin(acme, own!.id, false, adminId)).rejects.toThrow(/your own/);
  });

  it('keeps kiosk punching working', async () => {
    await setEmployeeLogin(acme, acmeEmployee, false, adminId);
    const entry = await clockIn({
      companyId: acme,
      employeeId: acmeEmployee,
      source: 'kiosk',
      actorUserId: null,
    });
    expect(entry.employeeId).toBe(acmeEmployee);
  });
});
