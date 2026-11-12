// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
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
import { resolvePayPeriod, resolveWorkWeek } from '@vibept/shared';
import {
  copyLastWeek,
  createManualEntry,
  deleteManualEntry,
  updateManualEntry,
} from '../manual-entries.js';
import { hashPassword } from '../passwords.js';
import { clockIn, clockOut } from '../punch.js';
import { setTimeOffType } from '../time-off.js';
import { hoursByPeriodReport } from '../reports/hours-by-period.js';
import { timeCardReport } from '../reports/time-card.js';
import { getTimesheet } from '../timesheets.js';

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

  it('a superseded punch drops out of the timesheet and the hours reports', async () => {
    // The real case: a phone punch auto-closed, then fixed with a manual
    // entry for the day. Only the manual hours may count — the punch
    // stays in the table for the audit trail.
    const punch = await clockIn({
      companyId,
      employeeId,
      source: 'web',
      actorUserId: employeeUserId,
    });
    await clockOut({ companyId, employeeId, source: 'web', actorUserId: employeeUserId });
    await db('time_entries').where({ id: punch.id }).update({ is_auto_closed: true });
    const { entry } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: null,
      durationSeconds: 9 * 3600,
      reason: "Didn't clock out",
      actor: { userId: supervisorUserId, roleGlobal: 'none' },
    });

    const sheet = await getTimesheet(companyId, employeeId);
    expect(sheet.entries.map((e) => e.id)).toEqual([entry.id]);
    expect(sheet.totals.workSeconds).toBe(9 * 3600);

    const periodStart = sheet.period.start;
    const periodEnd = sheet.period.end;
    const card = [];
    for await (const row of timeCardReport.rows(companyId, {
      employeeId,
      periodStart,
      periodEnd,
    })) {
      card.push(row as Record<string, unknown>);
    }
    // The punch's own row is gone; the manual entry's row remains.
    expect(card.filter((r) => r.source === 'web')).toHaveLength(0);
    expect(card.filter((r) => r.source === 'web_manual')).toHaveLength(1);

    const byPeriod = [];
    for await (const row of hoursByPeriodReport.rows(companyId, { periodStart, periodEnd })) {
      byPeriod.push(row as Record<string, unknown>);
    }
    expect(byPeriod.find((r) => r.lastName === 'Loyee')?.workSeconds).toBe(9 * 3600);
    // The trailing TOTAL row sums every employee row's hours columns.
    const total = byPeriod[byPeriod.length - 1]!;
    const people = byPeriod.slice(0, -1);
    expect(total).toMatchObject({
      lastName: 'TOTAL',
      firstName: `${people.length} employee${people.length === 1 ? '' : 's'}`,
    });
    for (const key of ['regularSeconds', 'overtimeSeconds', 'workSeconds', 'paidTotalSeconds']) {
      expect(total[key]).toBe(people.reduce((sum, r) => sum + Number(r[key]), 0));
    }
  });

  it('getTimesheet `at` picks the pay period containing that instant', async () => {
    const current = await getTimesheet(companyId, employeeId);
    const previous = await getTimesheet(companyId, employeeId, {
      at: new Date(new Date(current.period.start).getTime() - 1),
    });
    const next = await getTimesheet(companyId, employeeId, { at: new Date(current.period.end) });
    expect(previous.period.end).toBe(current.period.start);
    expect(next.period.start).toBe(current.period.end);
    expect(previous.period.type).toBe('bi_weekly');
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

  // --- future days + the pay-period approval lock ---

  function addDays(isoDay: string, n: number): string {
    const d = new Date(`${isoDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  it('refuses future worked time from the employee but not planned time off or a supervisor', async () => {
    const tomorrow = addDays(today(), 1);
    const asEmployee = { userId: employeeUserId, roleGlobal: 'none' as const };
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: tomorrow,
        jobId: jobA,
        durationSeconds: 3600,
        reason: 'ahead of time',
        actor: asEmployee,
      }),
    ).rejects.toThrow(/future day/);

    const types = await setTimeOffType(companyId, 'pto', true);
    const pto = types.find((t) => t.category === 'pto')!.jobId!;
    await db('company_settings')
      .where({ company_id: companyId })
      .update({ time_off_self_entry: true });
    const { entry: planned } = await createManualEntry({
      companyId,
      employeeId,
      day: tomorrow,
      jobId: pto,
      durationSeconds: 8 * 3600,
      reason: '',
      actor: asEmployee,
    });
    expect(planned.id).toBeGreaterThan(0);

    const { entry: scheduled } = await createManualEntry({
      companyId,
      employeeId,
      day: tomorrow,
      jobId: jobA,
      durationSeconds: 3600,
      reason: 'pre-entered by supervisor',
      actor: { userId: supervisorUserId, roleGlobal: 'none' },
    });
    expect(scheduled.id).toBeGreaterThan(0);
  });

  it('copy-last-week skips future days for the employee', async () => {
    // Prior-week source: a worked hour on every day of last week.
    for (let i = 0; i < 7; i++) {
      const start = new Date(`${addDays(today(), i - 7)}T09:00:00Z`);
      await db('time_entries').insert({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: db.raw('gen_random_uuid()'),
        entry_type: 'work',
        job_id: jobA,
        started_at: start,
        ended_at: new Date(start.getTime() + 3600_000),
        duration_seconds: 3600,
        source: 'web',
      });
    }
    const result = await copyLastWeek({
      companyId,
      employeeId,
      weekStart: today(),
      reason: 'same as last week',
      actor: { userId: employeeUserId, roleGlobal: 'none' },
    });
    // Only today is not in the future.
    expect(result.createdCount).toBe(1);
    expect(result.skippedCount).toBe(6);
  });

  it('locks the approved week to the employee, not just approved days', async () => {
    const period = resolvePayPeriod(new Date(), {
      type: 'bi_weekly',
      weekStartDay: 0,
      timezone: 'UTC',
    });
    const week = resolveWorkWeek(new Date(), { weekStartDay: 0, timezone: 'UTC' });
    const lockStart = period.start > week.start ? period.start : week.start;
    const periodStartDay = lockStart.toISOString().slice(0, 10);
    const insertApproved = async (day: string) =>
      db('time_entries').insert({
        company_id: companyId,
        employee_id: employeeId,
        shift_id: db.raw('gen_random_uuid()'),
        entry_type: 'work',
        started_at: new Date(`${day}T12:00:00Z`),
        ended_at: new Date(`${day}T13:00:00Z`),
        duration_seconds: 3600,
        source: 'web',
        approved_at: db.fn.now(),
        approved_by: adminUserId,
      });
    const asEmployee = { userId: employeeUserId, roleGlobal: 'none' as const };

    // Approved time before this week (the previous period, or week 1 of
    // this one) doesn't lock it.
    await insertApproved(addDays(periodStartDay, -1));
    const { entry } = await createManualEntry({
      companyId,
      employeeId,
      day: today(),
      jobId: jobA,
      durationSeconds: 3600,
      reason: 'fine',
      actor: asEmployee,
    });
    expect(entry.id).toBeGreaterThan(0);

    // Approved time on another day of this week of the period does.
    const otherDay = periodStartDay !== today() ? periodStartDay : addDays(today(), 1);
    await insertApproved(otherDay);
    await expect(
      createManualEntry({
        companyId,
        employeeId,
        day: today(),
        jobId: null,
        durationSeconds: 3600,
        reason: 'locked',
        actor: asEmployee,
      }),
    ).rejects.toThrow(/already approved/);
  });
});
