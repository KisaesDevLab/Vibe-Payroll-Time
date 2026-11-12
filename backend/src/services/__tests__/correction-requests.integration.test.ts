// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Correction requests: what an employee may ask for, and what happens
 * when a supervisor decides. Skipped when Postgres isn't reachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import {
  approveCorrectionRequest,
  createCorrectionRequest,
  listMyCorrectionRequests,
  rejectCorrectionRequest,
} from '../correction-requests.js';
import { createManualEntry } from '../manual-entries.js';
import { createEntryForEmployee } from '../punch.js';
import { setTimeOffType } from '../time-off.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let companyId = 0;
let employeeId = 0;
let otherEmployeeId = 0;
let workerId = 0;
let supervisorId = 0;
let jobA = 0;

async function seed() {
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
      { email: 'other@acme.test', password_hash: 'x', role_global: 'none' },
    ])
    .returning<Array<{ id: number }>>('id');
  workerId = users[0]!.id;
  supervisorId = users[1]!.id;
  const [company] = await db('companies')
    .insert({ name: 'Acme', slug: 'acme', timezone: 'UTC', pay_period_type: 'weekly' })
    .returning<Array<{ id: number }>>('id');
  companyId = company!.id;
  await db('company_settings').insert({
    company_id: companyId,
    employee_manual_entry_mode: 'override_only',
  });
  await db('company_memberships').insert([
    { user_id: workerId, company_id: companyId, role: 'employee' },
    { user_id: supervisorId, company_id: companyId, role: 'supervisor' },
    { user_id: users[2]!.id, company_id: companyId, role: 'employee' },
  ]);
  const emps = await db('employees')
    .insert([
      {
        company_id: companyId,
        user_id: workerId,
        first_name: 'W',
        last_name: 'One',
        status: 'active',
      },
      {
        company_id: companyId,
        user_id: users[2]!.id,
        first_name: 'O',
        last_name: 'Two',
        status: 'active',
      },
    ])
    .returning<Array<{ id: number }>>('id');
  employeeId = emps[0]!.id;
  otherEmployeeId = emps[1]!.id;
  const [job] = await db('jobs')
    .insert({ company_id: companyId, code: 'A', name: 'Job A' })
    .returning<Array<{ id: number }>>('id');
  jobA = job!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

async function entry(fromH: number, toH: number, emp = employeeId) {
  return createEntryForEmployee(
    {
      employeeId: emp,
      startedAt: hoursAgo(fromH),
      endedAt: hoursAgo(toH),
      entryType: 'work',
      reason: 'seed',
    },
    { userId: supervisorId, companyId },
  );
}

function editRequest(timeEntryId: number, startedAt = hoursAgo(6)) {
  return createCorrectionRequest(companyId, employeeId, workerId, {
    requestType: 'edit',
    timeEntryId,
    proposedChanges: { startedAt },
    reason: 'Clocked in late',
  });
}

const sup = () => ({ userId: supervisorId });

describe.skipIf(!dbReachable)('correction requests', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(seed);

  // --- create ---

  it('refuses a second pending request for the same entry', async () => {
    const e = await entry(5, 3);
    await editRequest(e.id);
    await expect(editRequest(e.id, hoursAgo(7))).rejects.toMatchObject({ status: 409 });
    await expect(
      createCorrectionRequest(companyId, employeeId, workerId, {
        requestType: 'delete',
        timeEntryId: e.id,
        proposedChanges: {},
        reason: 'Never worked',
      }),
    ).rejects.toThrow(/already a pending request/);
  });

  it('allows a new request once the earlier one is decided', async () => {
    const e = await entry(5, 3);
    const first = await editRequest(e.id);
    await rejectCorrectionRequest(companyId, first.id, sup(), {});
    const second = await editRequest(e.id);
    expect(second.status).toBe('pending');
  });

  it('applies the add-time limits to an add request', async () => {
    const add = (startedAt: string, endedAt: string) =>
      createCorrectionRequest(companyId, employeeId, workerId, {
        requestType: 'add',
        proposedChanges: { entryType: 'work', startedAt, endedAt, jobId: jobA },
        reason: 'Missed punch',
      });
    await expect(add(hoursAgo(1), hoursAgo(-3))).rejects.toThrow(/future/);
    await expect(add(hoursAgo(30), hoursAgo(1))).rejects.toThrow(/24 hours/);
    await expect(add(hoursAgo(2), hoursAgo(3))).rejects.toThrow(/after clock-in/);
    expect((await add(hoursAgo(3), hoursAgo(1))).status).toBe('pending');
  });

  it("refuses edits to another employee's entry", async () => {
    const theirs = await entry(5, 3, otherEmployeeId);
    await expect(editRequest(theirs.id)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses requests against approved, superseded or deleted entries', async () => {
    const approved = await entry(10, 9);
    await db('time_entries').where({ id: approved.id }).update({ approved_at: db.fn.now() });
    await expect(editRequest(approved.id, hoursAgo(11))).rejects.toThrow(/approved/);

    const superseded = await entry(8, 7);
    const replacement = await entry(6, 5);
    await db('time_entries')
      .where({ id: superseded.id })
      .update({ superseded_by_entry_id: replacement.id });
    await expect(editRequest(superseded.id, hoursAgo(8.5))).rejects.toThrow(/replaced/);

    const deleted = await entry(4, 3);
    await db('time_entries').where({ id: deleted.id }).update({ deleted_at: db.fn.now() });
    await expect(editRequest(deleted.id, hoursAgo(4.5))).rejects.toMatchObject({ status: 404 });
  });

  it('refuses requests against a time-off entry', async () => {
    const types = await setTimeOffType(companyId, 'pto', true);
    const pto = types.find((t) => t.category === 'pto')!.jobId!;
    const { entry: dayOff } = await createManualEntry({
      companyId,
      employeeId,
      day: new Date().toISOString().slice(0, 10),
      jobId: pto,
      durationSeconds: 3600,
      reason: '',
      actor: { userId: supervisorId, roleGlobal: 'none' },
    });
    await expect(
      createCorrectionRequest(companyId, employeeId, workerId, {
        requestType: 'delete',
        timeEntryId: dayOff.id,
        proposedChanges: {},
        reason: 'Not off',
      }),
    ).rejects.toThrow(/weekly grid/);
  });

  // --- decide ---

  it('applies an approved edit and marks the request approved', async () => {
    const e = await entry(5, 3);
    const req = await editRequest(e.id, hoursAgo(6));
    const decided = await approveCorrectionRequest(companyId, req.id, sup(), { reviewNote: 'ok' });
    expect(decided.status).toBe('approved');
    const row = await db('time_entries').where({ id: e.id }).first();
    expect(Math.abs(Number(row.duration_seconds) - 3 * 3600)).toBeLessThanOrEqual(2);
  });

  it('refuses to apply when the entry was approved after the request', async () => {
    const e = await entry(5, 3);
    const req = await editRequest(e.id);
    await db('time_entries').where({ id: e.id }).update({ approved_at: db.fn.now() });
    await expect(approveCorrectionRequest(companyId, req.id, sup(), {})).rejects.toMatchObject({
      status: 409,
      message: expect.stringMatching(/approved since/),
    });
    const row = await db('time_entries').where({ id: e.id }).first();
    expect(row.started_at.toISOString()).toBe(e.startedAt);
    const stillPending = await db('correction_requests').where({ id: req.id }).first();
    expect(stillPending.status).toBe('pending');
  });

  it('refuses to apply when the entry was deleted or superseded after the request', async () => {
    const e = await entry(5, 3);
    const req = await editRequest(e.id);
    await db('time_entries').where({ id: e.id }).update({ deleted_at: db.fn.now() });
    await expect(approveCorrectionRequest(companyId, req.id, sup(), {})).rejects.toThrow(
      /deleted since/,
    );

    const f = await entry(10, 9);
    const g = await entry(8, 7);
    const req2 = await editRequest(f.id, hoursAgo(11));
    await db('time_entries').where({ id: f.id }).update({ superseded_by_entry_id: g.id });
    await expect(approveCorrectionRequest(companyId, req2.id, sup(), {})).rejects.toThrow(
      /replaced/,
    );
  });

  it('refuses stored proposed changes that no longer match the contract', async () => {
    const e = await entry(5, 3);
    const req = await editRequest(e.id);
    await db('correction_requests')
      .where({ id: req.id })
      .update({ proposed_changes: JSON.stringify({ startedAt: 'yesterday-ish', ended: 1 }) });
    await expect(approveCorrectionRequest(companyId, req.id, sup(), {})).rejects.toThrow(
      /no longer valid/,
    );
  });

  it('rolls the whole approval back when applying the change fails', async () => {
    await entry(9, 7);
    const e = await entry(5, 3);
    // Valid when asked; overlaps once an entry lands in the way.
    const req = await editRequest(e.id, hoursAgo(6));
    await entry(6.5, 5.5);
    await expect(approveCorrectionRequest(companyId, req.id, sup(), {})).rejects.toThrow(/overlap/);
    const stillPending = await db('correction_requests').where({ id: req.id }).first();
    expect(stillPending.status).toBe('pending');
  });

  it('applies an add request exactly once when two reviewers approve at the same time', async () => {
    const req = await createCorrectionRequest(companyId, employeeId, workerId, {
      requestType: 'add',
      proposedChanges: { entryType: 'work', startedAt: hoursAgo(4), endedAt: hoursAgo(2) },
      reason: 'Missed punch',
    });
    const results = await Promise.allSettled([
      approveCorrectionRequest(companyId, req.id, sup(), {}),
      approveCorrectionRequest(companyId, req.id, sup(), {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/Already decided/);
    expect(await db('time_entries').where({ employee_id: employeeId })).toHaveLength(1);
  });

  it('will not reject a request that was already approved', async () => {
    const e = await entry(5, 3);
    const req = await editRequest(e.id);
    await approveCorrectionRequest(companyId, req.id, sup(), {});
    await expect(rejectCorrectionRequest(companyId, req.id, sup(), {})).rejects.toThrow(
      /Already decided/,
    );
  });

  // --- list ---

  it("lists an employee's own requests, newest first", async () => {
    const a = await entry(5, 3);
    const b = await entry(9, 7);
    const first = await editRequest(a.id);
    const second = await editRequest(b.id, hoursAgo(10));
    const theirs = await entry(5, 3, otherEmployeeId);
    await createCorrectionRequest(companyId, otherEmployeeId, null, {
      requestType: 'delete',
      timeEntryId: theirs.id,
      proposedChanges: {},
      reason: 'x',
    });
    const mine = await listMyCorrectionRequests(companyId, employeeId);
    expect(mine.map((r) => r.id)).toEqual([second.id, first.id]);
  });
});
