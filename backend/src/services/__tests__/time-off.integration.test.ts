// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Time off (PTO, sick, holiday, unpaid) recorded through job codes.
 *
 * Covers:
 *   - Settings → Time off switches create, archive and restore the codes
 *   - a time-off manual entry needs no reason and never supersedes punches
 *   - `time_off_self_entry = false` stops employees, not supervisors
 *   - punching into a time-off code is refused
 *   - the timesheet keeps time off out of worked hours and overtime
 *   - a code with approved entries can't flip between work and time off
 *
 * Skipped when Postgres isn't reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { updateJob } from '../jobs.js';
import { createManualEntry } from '../manual-entries.js';
import { clockIn, clockOut } from '../punch.js';
import { listTimeOffTypes, setTimeOffType } from '../time-off.js';
import { getTimesheet } from '../timesheets.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let companyId = 0;
let employeeId = 0;
let employeeUserId = 0;
let supervisorUserId = 0;

async function seed() {
  await db.raw(
    `TRUNCATE TABLE
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  const users = await db('users')
    .insert([
      { email: 'sup@vibept.local', password_hash: 'x', role_global: 'none' },
      { email: 'emp@vibept.local', password_hash: 'x', role_global: 'none' },
    ])
    .returning<Array<{ id: number }>>('id');
  supervisorUserId = users[0]!.id;
  employeeUserId = users[1]!.id;
  const [company] = await db('companies')
    .insert({ name: 'Test Co', slug: 'test-co', timezone: 'UTC', pay_period_type: 'weekly' })
    .returning<Array<{ id: number }>>('id');
  companyId = company!.id;
  await db('company_settings').insert({ company_id: companyId });
  await db('company_memberships').insert([
    { user_id: supervisorUserId, company_id: companyId, role: 'supervisor' },
    { user_id: employeeUserId, company_id: companyId, role: 'employee' },
  ]);
  const [employee] = await db('employees')
    .insert({
      company_id: companyId,
      user_id: employeeUserId,
      first_name: 'Emp',
      last_name: 'Loyee',
      status: 'active',
    })
    .returning<Array<{ id: number }>>('id');
  employeeId = employee!.id;
}

const today = () => new Date().toISOString().slice(0, 10);
const asEmployee = () => ({ userId: employeeUserId, roleGlobal: 'none' as const });
const asSupervisor = () => ({ userId: supervisorUserId, roleGlobal: 'none' as const });

async function ptoJobId(): Promise<number> {
  const types = await setTimeOffType(companyId, 'pto', true);
  return types.find((t) => t.category === 'pto')!.jobId!;
}

describe.skipIf(!dbReachable)('time off (DB-backed)', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(seed);

  it('switches a type on, off and back on through one job code', async () => {
    expect((await listTimeOffTypes(companyId)).every((t) => !t.enabled)).toBe(true);

    const on = await setTimeOffType(companyId, 'pto', true);
    const pto = on.find((t) => t.category === 'pto')!;
    expect(pto.enabled).toBe(true);
    const job = await db('jobs').where({ id: pto.jobId! }).first();
    expect(job).toMatchObject({ code: 'PTO', is_time_off: true, time_off_category: 'pto' });

    const off = await setTimeOffType(companyId, 'pto', false);
    expect(off.find((t) => t.category === 'pto')).toMatchObject({
      enabled: false,
      jobId: pto.jobId,
    });
    expect((await db('jobs').where({ id: pto.jobId! }).first())?.archived_at).not.toBeNull();

    const again = await setTimeOffType(companyId, 'pto', true);
    expect(again.find((t) => t.category === 'pto')).toMatchObject({
      enabled: true,
      jobId: pto.jobId,
    });
    expect(await db('jobs').where({ company_id: companyId }).count('* as n')).toEqual([{ n: '1' }]);

    const unpaid = await setTimeOffType(companyId, 'unpaid', true);
    expect(unpaid.find((t) => t.category === 'unpaid')?.isPaid).toBe(false);
  });

  it('records time off without a reason and keeps it out of worked hours', async () => {
    const pto = await ptoJobId();
    const punch = await clockIn({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });
    await clockOut({ companyId, employeeId, source: 'web', actorUserId: employeeUserId });

    const { entry, supersededEntryIds } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: pto,
      durationSeconds: 4 * 3600,
      reason: '',
      actor: asEmployee(),
    });
    expect(entry.entryReason).toBe('Time off');
    expect(supersededEntryIds).toEqual([]);
    const stillLive = await db('time_entries').where({ id: punch.id }).first();
    expect(stillLive?.superseded_by_entry_id).toBeNull();

    const sheet = await getTimesheet(companyId, employeeId);
    expect(sheet.timeOff.totalSeconds).toBe(4 * 3600);
    expect(sheet.timeOff.byCategory.pto).toBe(4 * 3600);
    expect(sheet.totals.workSeconds).toBeLessThan(3600);
    expect(sheet.totals.overtimeSeconds).toBe(0);
  });

  it('lets only supervisors record time off when self entry is off', async () => {
    const pto = await ptoJobId();
    await db('company_settings')
      .where({ company_id: companyId })
      .update({ time_off_self_entry: false });
    const input = {
      companyId,
      employeeId,
      day: today(),
      jobId: pto,
      durationSeconds: 8 * 3600,
      reason: '',
    };
    await expect(createManualEntry({ ...input, actor: asEmployee() })).rejects.toThrow(
      /records time off for you/,
    );
    const ok = await createManualEntry({ ...input, actor: asSupervisor() });
    expect(ok.entry.durationSeconds).toBe(8 * 3600);
  });

  it('still requires a reason for worked-time manual entries', async () => {
    const [job] = await db('jobs')
      .insert({ company_id: companyId, code: 'A', name: 'Job A' })
      .returning<Array<{ id: number }>>('id');
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: job!.id,
        durationSeconds: 3600,
        reason: '  ',
        actor: asSupervisor(),
      }),
    ).rejects.toThrow(/Reason is required/);
  });

  it('refuses to punch into a time-off code', async () => {
    const pto = await ptoJobId();
    await expect(
      clockIn(
        { companyId, employeeId, source: 'web', actorUserId: employeeUserId },
        { jobId: pto },
      ),
    ).rejects.toThrow(/not punched/);
  });

  it('will not reclassify a code that has approved entries', async () => {
    const pto = await ptoJobId();
    const { entry } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: pto,
      durationSeconds: 3600,
      reason: '',
      actor: asSupervisor(),
    });
    await db('time_entries').where({ id: entry.id }).update({ approved_at: db.fn.now() });
    await expect(updateJob(companyId, pto, { isTimeOff: false })).rejects.toThrow(
      /approved entries/,
    );
  });
});
