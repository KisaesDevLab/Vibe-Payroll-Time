// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * "Add time" on My timesheet: an employee types in a shift they forgot
 * to punch. Saved directly under the `allowed` manual-entry policy; a
 * correction request otherwise, which creates the entry when approved.
 *
 * Skipped when Postgres isn't reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { approveCorrectionRequest } from '../correction-requests.js';
import { addOwnEntry } from '../own-entries.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let companyId = 0;
let employeeId = 0;
let workerId = 0;
let supervisorId = 0;

async function seed(mode: 'allowed' | 'override_only' | 'disabled' = 'allowed') {
  await db.raw(
    `TRUNCATE TABLE
       correction_requests, time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  const users = await db('users')
    .insert([
      { email: 'worker@acme.test', password_hash: 'x', role_global: 'none' },
      { email: 'sup@acme.test', password_hash: 'x', role_global: 'none' },
    ])
    .returning<Array<{ id: number }>>('id');
  workerId = users[0]!.id;
  supervisorId = users[1]!.id;
  const [company] = await db('companies')
    .insert({ name: 'Acme', slug: 'acme', timezone: 'UTC', pay_period_type: 'weekly' })
    .returning<Array<{ id: number }>>('id');
  companyId = company!.id;
  await db('company_settings').insert({ company_id: companyId, employee_manual_entry_mode: mode });
  await db('company_memberships').insert([
    { user_id: workerId, company_id: companyId, role: 'employee' },
    { user_id: supervisorId, company_id: companyId, role: 'supervisor' },
  ]);
  const [employee] = await db('employees')
    .insert({
      company_id: companyId,
      user_id: workerId,
      first_name: 'W',
      last_name: 'One',
      status: 'active',
    })
    .returning<Array<{ id: number }>>('id');
  employeeId = employee!.id;
}

/** Yesterday, between two UTC hours. */
function shift(fromHour: number, toHour: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const at = (h: number) => {
    const x = new Date(d);
    x.setUTCHours(h, 0, 0, 0);
    return x.toISOString();
  };
  return { startedAt: at(fromHour), endedAt: at(toHour) };
}

describe.skipIf(!dbReachable)('add own time', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(() => seed());

  it('saves the shift directly when employees may enter time', async () => {
    const r = await addOwnEntry(companyId, workerId, { ...shift(8, 12), reason: 'Phone died' });
    expect(r.status).toBe('added');
    expect(r.entry?.durationSeconds).toBe(4 * 3600);
    const audit = await db('time_entry_audit').where({ time_entry_id: r.entry!.id }).first();
    expect(audit).toMatchObject({
      action: 'create',
      actor_user_id: workerId,
      reason: 'Phone died',
    });
  });

  it('refuses an overlapping shift and one ending in the future', async () => {
    await addOwnEntry(companyId, workerId, { ...shift(8, 12), reason: 'Forgot' });
    await expect(
      addOwnEntry(companyId, workerId, { ...shift(11, 14), reason: 'Again' }),
    ).rejects.toThrow(/overlaps/);
    const later = new Date(Date.now() + 3 * 3600_000).toISOString();
    await expect(
      addOwnEntry(companyId, workerId, {
        startedAt: new Date().toISOString(),
        endedAt: later,
        reason: 'Future',
      }),
    ).rejects.toThrow(/future/);
  });

  it('sends a request under a stricter policy, and approving it adds the shift', async () => {
    await seed('override_only');
    const r = await addOwnEntry(companyId, workerId, { ...shift(9, 17), reason: 'Missed punch' });
    expect(r.status).toBe('requested');
    expect(await db('time_entries').where({ employee_id: employeeId }).first()).toBeUndefined();

    await approveCorrectionRequest(companyId, r.request!.id, { userId: supervisorId }, {});
    const entry = await db('time_entries').where({ employee_id: employeeId }).first();
    expect(Number(entry?.duration_seconds)).toBe(8 * 3600);
    expect(entry?.created_by).toBe(supervisorId);
  });

  it('sends a request when the day is already approved', async () => {
    const first = await addOwnEntry(companyId, workerId, { ...shift(6, 7), reason: 'Early' });
    await db('time_entries').where({ id: first.entry!.id }).update({ approved_at: db.fn.now() });
    const r = await addOwnEntry(companyId, workerId, { ...shift(9, 10), reason: 'Later' });
    expect(r.status).toBe('requested');
  });
});
