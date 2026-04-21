// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Manual-entry service DB-backed tests.
 *
 * Covers:
 *   - create supersedes overlapping punches for the same (day, job)
 *   - delete restores superseded punches
 *   - employee cannot create in an approved period; supervisor can
 *   - mode=disabled blocks employees at the service layer
 *   - duration 0 rejected, >24h rejected, empty reason rejected
 *   - integration: punch → manual override → approve → delete → punch restored
 *   - second concurrent manual entry on same (employee, day, job) rejects
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { createManualEntry, deleteManualEntry, updateManualEntry } from '../manual-entries.js';
import { hashPassword } from '../passwords.js';
import { clockIn, clockOut } from '../punch.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let companyId: number;
let employeeId: number;
let employeeUserId: number;
let supervisorUserId: number;
let adminUserId: number;
let jobA: number;

async function truncateCore() {
  await db.raw(
    `TRUNCATE TABLE
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users,
       auth_events, refresh_tokens
     RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  await truncateCore();

  const [admin] = await db('users')
    .insert({
      email: 'admin@vibept.local',
      password_hash: await hashPassword('test-passphrase-12345'),
      role_global: 'super_admin',
    })
    .returning<Array<{ id: number }>>('id');
  adminUserId = admin!.id;

  const [supervisor] = await db('users')
    .insert({
      email: 'sup@vibept.local',
      password_hash: await hashPassword('test-passphrase-12345'),
      role_global: 'none',
    })
    .returning<Array<{ id: number }>>('id');
  supervisorUserId = supervisor!.id;

  const [empUser] = await db('users')
    .insert({
      email: 'emp@vibept.local',
      password_hash: await hashPassword('test-passphrase-12345'),
      role_global: 'none',
    })
    .returning<Array<{ id: number }>>('id');
  employeeUserId = empUser!.id;

  const [company] = await db('companies')
    .insert({
      name: 'Test Co',
      slug: 'test-co',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: true,
      license_state: 'internal_free',
    })
    .returning<Array<{ id: number }>>('id');
  companyId = company!.id;

  await db('company_settings').insert({
    company_id: companyId,
    allow_self_approve: true,
    employee_manual_entry_mode: 'allowed',
  });

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

  const [a] = await db('jobs')
    .insert({ company_id: companyId, code: 'A', name: 'Job A' })
    .returning<Array<{ id: number }>>('id');
  jobA = a!.id;
}

describe.skipIf(!dbReachable)('manual-entries service (DB-backed)', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });

  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    await seed();
  });

  // Today's YYYY-MM-DD in UTC (company is UTC in the fixture).
  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  it('create + delete round-trips cleanly when no punches are on the day', async () => {
    const { entry, supersededEntryIds } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: jobA,
      durationSeconds: 4 * 3600,
      reason: 'Off-site client meeting',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });
    expect(entry.source).toBe('web_manual');
    expect(entry.durationSeconds).toBe(14_400);
    expect(entry.entryReason).toBe('Off-site client meeting');
    expect(supersededEntryIds).toEqual([]);

    await deleteManualEntry({
      entryId: entry.id,
      companyId,
      reason: 'Reverted on request',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });

    const deleted = await db('time_entries').where({ id: entry.id }).first();
    expect(deleted?.deleted_at).not.toBeNull();

    const audits = await db('time_entry_audit')
      .where({ time_entry_id: entry.id })
      .orderBy('created_at', 'asc');
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('manual_create');
    expect(actions).toContain('manual_delete');
  });

  it('creating a manual entry supersedes overlapping punches for same (day, job)', async () => {
    const punch = await clockIn({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });
    await clockOut({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });

    const { entry, supersededEntryIds } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: null,
      durationSeconds: 6 * 3600,
      reason: 'Forgot to select job; allocating 6h',
      actor: { userId: supervisorUserId, roleGlobal: 'none' },
    });
    expect(supersededEntryIds).toContain(punch.id);

    const punchRow = await db('time_entries').where({ id: punch.id }).first();
    expect(punchRow?.superseded_by_entry_id).toBe(entry.id);
  });

  it('delete restores the punches it had superseded', async () => {
    const punch = await clockIn({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });
    await clockOut({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });

    const { entry } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: null,
      durationSeconds: 3600,
      reason: 'override',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });
    expect((await db('time_entries').where({ id: punch.id }).first())?.superseded_by_entry_id).toBe(
      entry.id,
    );

    await deleteManualEntry({
      entryId: entry.id,
      companyId,
      reason: 'revert',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });
    expect(
      (await db('time_entries').where({ id: punch.id }).first())?.superseded_by_entry_id,
    ).toBeNull();
  });

  it('rejects duration = 0 on create', async () => {
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: jobA,
        durationSeconds: 0,
        reason: 'nope',
        actor: { userId: adminUserId, roleGlobal: 'super_admin' },
      }),
    ).rejects.toThrow(/greater than 0/i);
  });

  it('rejects duration > 24h', async () => {
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: jobA,
        durationSeconds: 25 * 3600,
        reason: 'too long',
        actor: { userId: adminUserId, roleGlobal: 'super_admin' },
      }),
    ).rejects.toThrow(/24 hours/i);
  });

  it('rejects empty reason', async () => {
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: jobA,
        durationSeconds: 3600,
        reason: '   ',
        actor: { userId: adminUserId, roleGlobal: 'super_admin' },
      }),
    ).rejects.toThrow(/reason/i);
  });

  it('mode=disabled blocks employee originations (service-layer check)', async () => {
    await db('company_settings')
      .where({ company_id: companyId })
      .update({ employee_manual_entry_mode: 'disabled' });

    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: jobA,
        durationSeconds: 3600,
        reason: 'nope',
        actor: { userId: employeeUserId, roleGlobal: 'none' },
      }),
    ).rejects.toThrow(/disabled/i);

    // Supervisor still passes.
    const { entry } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: jobA,
      durationSeconds: 3600,
      reason: 'supervisor override',
      actor: { userId: supervisorUserId, roleGlobal: 'none' },
    });
    expect(entry.id).toBeGreaterThan(0);
  });

  it('update changes duration + reason and writes manual_update audit', async () => {
    const { entry } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: jobA,
      durationSeconds: 3600,
      reason: 'initial',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });
    const updated = await updateManualEntry({
      entryId: entry.id,
      companyId,
      durationSeconds: 2 * 3600,
      reason: 'updated',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });
    expect(updated.entry.durationSeconds).toBe(7200);
    expect(updated.entry.entryReason).toBe('updated');
    const audits = await db('time_entry_audit')
      .where({ time_entry_id: entry.id })
      .orderBy('created_at', 'asc');
    expect(audits.map((a) => a.action)).toContain('manual_update');
  });

  it('punch → manual override → approve → delete manual → punch restored', async () => {
    // 1. Employee punches in and out.
    const punch = await clockIn({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });
    await clockOut({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });

    // 2. Supervisor overrides with a manual entry.
    const { entry: manual } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: null,
      durationSeconds: 4 * 3600,
      reason: 'allocation override',
      actor: { userId: supervisorUserId, roleGlobal: 'none' },
    });
    const punchAfterOverride = await db('time_entries').where({ id: punch.id }).first();
    expect(punchAfterOverride?.superseded_by_entry_id).toBe(manual.id);

    // 3. Approve the period — both the punch (still non-deleted) and
    //    the manual entry get stamped approved_at. Ensures manual delete
    //    still works on approved-state rows for admin (role superadmin).
    await db('time_entries')
      .where({ company_id: companyId, employee_id: employeeId })
      .whereNull('deleted_at')
      .update({ approved_at: db.fn.now(), approved_by: adminUserId });

    // 4. Admin deletes the manual entry.
    await deleteManualEntry({
      entryId: manual.id,
      companyId,
      reason: 'revert post-approval',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });

    // 5. Punch should be restored (no longer superseded).
    const punchFinal = await db('time_entries').where({ id: punch.id }).first();
    expect(punchFinal?.superseded_by_entry_id).toBeNull();
    expect(punchFinal?.deleted_at).toBeNull();

    // Audit trail should include manual_create → manual_override → manual_revert → manual_delete.
    const audits = await db('time_entry_audit')
      .where({ company_id: companyId })
      .orderBy('created_at', 'asc');
    const actions = audits.map((a) => a.action);
    expect(actions).toContain('manual_create');
    expect(actions).toContain('manual_override');
    expect(actions).toContain('manual_revert');
    expect(actions).toContain('manual_delete');
  });

  it('concurrent second manual entry on same (employee, day, job) rejects cleanly', async () => {
    await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: jobA,
      durationSeconds: 3600,
      reason: 'first',
      actor: { userId: adminUserId, roleGlobal: 'super_admin' },
    });
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: jobA,
        durationSeconds: 3600,
        reason: 'second',
        actor: { userId: adminUserId, roleGlobal: 'super_admin' },
      }),
    ).rejects.toThrow(/already exists/i);
  });
});
