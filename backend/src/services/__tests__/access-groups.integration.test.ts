// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Access groups: grants materialize into company_memberships as
 * group-granted rows, the highest role wins across groups, direct
 * memberships are never touched and take precedence, and the direct
 * membership paths (Team page, People page) leave group rows alone.
 *
 * Skipped when Postgres isn't reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import {
  createAccessGroup,
  deleteAccessGroup,
  setAccessGroupCompanies,
  setAccessGroupMembers,
} from '../access-groups.js';
import { reconcileMemberships } from '../admin-users.js';
import {
  listMembershipsForCompany,
  revokeMembership,
  updateMembershipRole,
} from '../memberships.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let alice = 0;
let bob = 0;
let acme = 0;
let bobs = 0;

async function seed() {
  await db.raw(
    `TRUNCATE TABLE
       access_group_companies, access_group_members, access_groups,
       employees, company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  const users = await db('users')
    .insert([
      { email: 'alice@firm.test', password_hash: 'x', role_global: 'none' },
      { email: 'bob@firm.test', password_hash: 'x', role_global: 'none' },
    ])
    .returning<Array<{ id: number }>>('id');
  alice = users[0]!.id;
  bob = users[1]!.id;
  const companies = await db('companies')
    .insert([
      { name: 'Acme', slug: 'acme', timezone: 'UTC', pay_period_type: 'weekly' },
      { name: "Bob's", slug: 'bobs', timezone: 'UTC', pay_period_type: 'weekly' },
    ])
    .returning<Array<{ id: number }>>('id');
  acme = companies[0]!.id;
  bobs = companies[1]!.id;
}

const access = (userId: number) =>
  db('company_memberships')
    .where({ user_id: userId })
    .orderBy('company_id')
    .select<
      Array<{ company_id: number; role: string; granted_by_group: boolean }>
    >('company_id', 'role', 'granted_by_group');

describe.skipIf(!dbReachable)('access groups', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy();
  });
  beforeEach(seed);

  it('grants members each company at the group role, and takes it back', async () => {
    const g = await createAccessGroup({ name: 'Audit team' });
    await setAccessGroupCompanies(g.id, {
      companies: [
        { companyId: acme, role: 'supervisor' },
        { companyId: bobs, role: 'employee' },
      ],
    });
    await setAccessGroupMembers(g.id, { userIds: [alice, bob] });

    expect(await access(alice)).toEqual([
      { company_id: acme, role: 'supervisor', granted_by_group: true },
      { company_id: bobs, role: 'employee', granted_by_group: true },
    ]);

    // Dropping a company from the group removes it for every member.
    await setAccessGroupCompanies(g.id, { companies: [{ companyId: acme, role: 'supervisor' }] });
    expect(await access(bob)).toEqual([
      { company_id: acme, role: 'supervisor', granted_by_group: true },
    ]);

    // Leaving the group removes the rest.
    await setAccessGroupMembers(g.id, { userIds: [alice] });
    expect(await access(bob)).toEqual([]);

    // Deleting the group takes away what it granted.
    await deleteAccessGroup(g.id);
    expect(await access(alice)).toEqual([]);
  });

  it('gives the highest role when several groups grant the same company', async () => {
    const low = await createAccessGroup({ name: 'Staff' });
    const high = await createAccessGroup({ name: 'Managers' });
    await setAccessGroupCompanies(low.id, { companies: [{ companyId: acme, role: 'employee' }] });
    await setAccessGroupCompanies(high.id, {
      companies: [{ companyId: acme, role: 'company_admin' }],
    });
    await setAccessGroupMembers(low.id, { userIds: [alice] });
    await setAccessGroupMembers(high.id, { userIds: [alice] });
    expect(await access(alice)).toEqual([
      { company_id: acme, role: 'company_admin', granted_by_group: true },
    ]);

    await setAccessGroupMembers(high.id, { userIds: [] });
    expect(await access(alice)).toEqual([
      { company_id: acme, role: 'employee', granted_by_group: true },
    ]);
  });

  it('never touches a direct membership, which takes precedence', async () => {
    await db('company_memberships').insert({ user_id: alice, company_id: acme, role: 'employee' });
    const g = await createAccessGroup({ name: 'Audit team' });
    await setAccessGroupCompanies(g.id, {
      companies: [{ companyId: acme, role: 'company_admin' }],
    });
    await setAccessGroupMembers(g.id, { userIds: [alice] });
    expect(await access(alice)).toEqual([
      { company_id: acme, role: 'employee', granted_by_group: false },
    ]);

    // Remove the direct membership: the group's grant applies.
    const direct = (await listMembershipsForCompany(acme)).find((m) => m.userId === alice)!;
    expect(direct.grantedByGroup).toBe(false);
    await revokeMembership(acme, direct.id);
    expect(await access(alice)).toEqual([
      { company_id: acme, role: 'company_admin', granted_by_group: true },
    ]);

    // Leaving the group no longer leaves anything behind.
    await setAccessGroupMembers(g.id, { userIds: [] });
    expect(await access(alice)).toEqual([]);
  });

  it('keeps group rows read-only on the Team and People paths', async () => {
    const g = await createAccessGroup({ name: 'Audit team' });
    await setAccessGroupCompanies(g.id, { companies: [{ companyId: acme, role: 'supervisor' }] });
    await setAccessGroupMembers(g.id, { userIds: [alice] });
    const row = (await listMembershipsForCompany(acme)).find((m) => m.userId === alice)!;
    expect(row.grantedByGroup).toBe(true);

    await expect(updateMembershipRole(acme, row.id, 'company_admin')).rejects.toThrow(
      /access group/,
    );
    await expect(revokeMembership(acme, row.id)).rejects.toThrow(/access group/);

    // The People page drawer reconciles DIRECT memberships only: an empty
    // desired set leaves the group's row, and naming the company is a no-op.
    await reconcileMemberships(alice, { memberships: [] });
    await reconcileMemberships(alice, { memberships: [{ companyId: acme, role: 'employee' }] });
    expect(await access(alice)).toEqual([
      { company_id: acme, role: 'supervisor', granted_by_group: true },
    ]);
  });

  it('refuses a duplicate group name', async () => {
    await createAccessGroup({ name: 'Audit team' });
    await expect(createAccessGroup({ name: 'Audit team' })).rejects.toThrow(/already exists/);
  });
});
