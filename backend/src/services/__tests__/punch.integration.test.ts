// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Punch-engine integration tests. Run against the dev Postgres (see
 * docker-compose.dev.yml) or the CI service container. Skipped when the
 * database is unreachable so `npm test` exits clean locally without
 * `docker compose up`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { hashPassword } from '../passwords.js';
import {
  breakIn,
  breakOut,
  clockIn,
  clockOut,
  createEntryForEmployee,
  switchJob,
} from '../punch.js';

// Probe once at module load so `describe.skipIf` gets a synchronous
// boolean. Top-level await is supported under NodeNext ESM.
const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let companyId: number;
let employeeId: number;
let actorUserId: number;
let jobA: number;
let jobB: number;

async function truncateCore() {
  // Order matters thanks to FKs. Cascade keeps us honest either way.
  await db.raw(
    `TRUNCATE TABLE
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
}

async function seed() {
  await truncateCore();

  const [user] = await db('users')
    .insert({
      email: 'test@vibept.local',
      password_hash: await hashPassword('test-passphrase-12345'),
      role_global: 'super_admin',
    })
    .returning<Array<{ id: number }>>('id');
  actorUserId = user!.id;

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

  await db('company_settings').insert({ company_id: companyId, allow_self_approve: true });

  const [employee] = await db('employees')
    .insert({
      company_id: companyId,
      user_id: actorUserId,
      first_name: 'Test',
      last_name: 'Employee',
      status: 'active',
    })
    .returning<Array<{ id: number }>>('id');
  employeeId = employee!.id;

  const [a] = await db('jobs')
    .insert({ company_id: companyId, code: 'A', name: 'Job A' })
    .returning<Array<{ id: number }>>('id');
  const [b] = await db('jobs')
    .insert({ company_id: companyId, code: 'B', name: 'Job B' })
    .returning<Array<{ id: number }>>('id');
  jobA = a!.id;
  jobB = b!.id;
}

function ctx() {
  return {
    companyId,
    employeeId,
    source: 'web' as const,
    sourceDeviceId: 'test-runner',
    actorUserId,
  };
}

describe.skipIf(!dbReachable)('punch service (DB-backed)', () => {
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

  it('clockIn creates a work entry with no jobId when none provided', async () => {
    const entry = await clockIn(ctx());
    expect(entry.entryType).toBe('work');
    expect(entry.jobId).toBeNull();
    expect(entry.endedAt).toBeNull();

    const audits = await db('time_entry_audit').where({ time_entry_id: entry.id });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('create');
  });

  it('rejects a second clockIn while an entry is open', async () => {
    await clockIn(ctx());
    await expect(clockIn(ctx())).rejects.toThrow(/open entry/i);
  });

  it('clockOut closes any open entry', async () => {
    await clockIn(ctx(), { jobId: jobA });
    const closed = await clockOut(ctx());
    expect(closed.endedAt).not.toBeNull();
    expect(closed.durationSeconds).not.toBeNull();
  });

  it('break cycle shares shift_id and resumes the prior job', async () => {
    const opened = await clockIn(ctx(), { jobId: jobA });
    const broke = await breakIn(ctx());
    const resumed = await breakOut(ctx());

    expect(broke.shiftId).toBe(opened.shiftId);
    expect(resumed.shiftId).toBe(opened.shiftId);
    expect(resumed.entryType).toBe('work');
    expect(resumed.jobId).toBe(jobA); // resumed on the original job
  });

  it('switchJob closes current work and opens new work with new job on the same shift', async () => {
    const a = await clockIn(ctx(), { jobId: jobA });
    const b = await switchJob(ctx(), jobB);
    expect(b.shiftId).toBe(a.shiftId);
    expect(b.jobId).toBe(jobB);
    expect(b.entryType).toBe('work');
  });

  it('rejects breakIn when no work entry is open', async () => {
    await expect(breakIn(ctx())).rejects.toThrow(/no open entry|not work/i);
  });

  it('rejects offline punches older than 72 hours', async () => {
    const tooOld = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
    await expect(
      clockIn({ ...ctx(), clientStartedAt: tooOld, clientClockSkewMs: 0 }),
    ).rejects.toThrow(/older than|rejected/i);
  });

  it('adjusts started_at using client skew for offline punches', async () => {
    const clientTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const skew = 2_000;
    const entry = await clockIn({
      ...ctx(),
      clientStartedAt: clientTime,
      clientClockSkewMs: skew,
    });
    const expectedStart = new Date(new Date(clientTime).getTime() + skew);
    // Allow 1s tolerance for test timing.
    expect(Math.abs(new Date(entry.startedAt).getTime() - expectedStart.getTime())).toBeLessThan(
      2000,
    );
    expect(entry.sourceOffline).toBe(true);
  });

  // --- createEntryForEmployee (supervisor missed-punch flow) ---

  it('createEntryForEmployee inserts a closed entry and writes a create audit row', async () => {
    const start = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() - 2 * 3600 * 1000).toISOString();

    const entry = await createEntryForEmployee(
      {
        employeeId,
        startedAt: start,
        endedAt: end,
        entryType: 'work',
        jobId: jobA,
        reason: 'Forgot to punch in yesterday',
      },
      { userId: actorUserId, companyId },
    );

    expect(entry.entryType).toBe('work');
    expect(entry.jobId).toBe(jobA);
    expect(entry.endedAt).not.toBeNull();
    expect(entry.durationSeconds).toBe(2 * 3600);

    const audits = await db('time_entry_audit').where({ time_entry_id: entry.id });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.action).toBe('create');
    expect(audits[0]?.reason).toBe('Forgot to punch in yesterday');
    expect(audits[0]?.actor_user_id).toBe(actorUserId);
  });

  it('createEntryForEmployee rejects endedAt <= startedAt', async () => {
    const t = new Date().toISOString();
    await expect(
      createEntryForEmployee(
        { employeeId, startedAt: t, endedAt: t, entryType: 'work', reason: 'x' },
        { userId: actorUserId, companyId },
      ),
    ).rejects.toThrow(/must be after/i);
  });

  it('createEntryForEmployee refuses to overlap an existing closed entry', async () => {
    const opened = await clockIn(ctx(), { jobId: jobA });
    await clockOut(ctx());
    const openedStart = new Date(opened.startedAt);

    // Propose a window that overlaps the just-closed entry.
    const overlapStart = new Date(openedStart.getTime() - 60_000).toISOString();
    const overlapEnd = new Date(openedStart.getTime() + 60_000).toISOString();
    await expect(
      createEntryForEmployee(
        {
          employeeId,
          startedAt: overlapStart,
          endedAt: overlapEnd,
          entryType: 'work',
          reason: 'dupe',
        },
        { userId: actorUserId, companyId },
      ),
    ).rejects.toThrow(/overlap/i);
  });

  it('createEntryForEmployee refuses to overlap an open entry', async () => {
    const opened = await clockIn(ctx(), { jobId: jobA });
    const openedStart = new Date(opened.startedAt);

    const overlapStart = new Date(openedStart.getTime() + 60_000).toISOString();
    const overlapEnd = new Date(openedStart.getTime() + 120_000).toISOString();
    await expect(
      createEntryForEmployee(
        {
          employeeId,
          startedAt: overlapStart,
          endedAt: overlapEnd,
          entryType: 'work',
          reason: 'dupe',
        },
        { userId: actorUserId, companyId },
      ),
    ).rejects.toThrow(/overlap/i);
  });

  it('createEntryForEmployee refuses a terminated employee', async () => {
    await db('employees').where({ id: employeeId }).update({ status: 'terminated' });
    const start = new Date(Date.now() - 3600 * 1000).toISOString();
    const end = new Date().toISOString();
    await expect(
      createEntryForEmployee(
        { employeeId, startedAt: start, endedAt: end, entryType: 'work', reason: 'x' },
        { userId: actorUserId, companyId },
      ),
    ).rejects.toThrow(/not active|terminated/i);
  });

  it('createEntryForEmployee rejects a jobId from a different company', async () => {
    // Make a foreign company with its own job.
    const [other] = await db('companies')
      .insert({
        name: 'Other Co',
        slug: 'other-co',
        timezone: 'UTC',
        pay_period_type: 'weekly',
        is_internal: false,
        license_state: 'trial',
      })
      .returning<Array<{ id: number }>>('id');
    const [otherJob] = await db('jobs')
      .insert({ company_id: other!.id, code: 'OX', name: 'Other Job' })
      .returning<Array<{ id: number }>>('id');

    const start = new Date(Date.now() - 3600 * 1000).toISOString();
    const end = new Date().toISOString();
    await expect(
      createEntryForEmployee(
        {
          employeeId,
          startedAt: start,
          endedAt: end,
          entryType: 'work',
          jobId: otherJob!.id,
          reason: 'wrong co',
        },
        { userId: actorUserId, companyId },
      ),
    ).rejects.toThrow(/Active job not found|not found/i);
  });

  it('captures source_ip + source_user_agent when provided in ctx', async () => {
    const entry = await clockIn({
      ...ctx(),
      sourceIp: '203.0.113.42',
      sourceUserAgent: 'Mozilla/5.0 (TestRunner)',
    });
    const row = await db('time_entries').where({ id: entry.id }).first();
    expect(row.source_ip).toBe('203.0.113.42');
    expect(row.source_user_agent).toBe('Mozilla/5.0 (TestRunner)');
    // Also surfaced on the mapped TimeEntry response.
    expect(entry.sourceIp).toBe('203.0.113.42');
    expect(entry.sourceUserAgent).toBe('Mozilla/5.0 (TestRunner)');
  });

  it('createEntryForEmployee captures admin IP/UA when supplied', async () => {
    const start = new Date(Date.now() - 3600 * 1000).toISOString();
    const end = new Date().toISOString();
    const entry = await createEntryForEmployee(
      { employeeId, startedAt: start, endedAt: end, entryType: 'work', reason: 'missed' },
      {
        userId: actorUserId,
        companyId,
        sourceIp: '198.51.100.7',
        sourceUserAgent: 'AdminBrowser/1.0',
      },
    );
    expect(entry.sourceIp).toBe('198.51.100.7');
    expect(entry.sourceUserAgent).toBe('AdminBrowser/1.0');
  });

  it('createEntryForEmployee drops jobId on a break entry', async () => {
    const start = new Date(Date.now() - 3600 * 1000).toISOString();
    const end = new Date().toISOString();
    const entry = await createEntryForEmployee(
      {
        employeeId,
        startedAt: start,
        endedAt: end,
        entryType: 'break',
        jobId: jobA, // should be ignored for break
        reason: 'Lunch',
      },
      { userId: actorUserId, companyId },
    );
    expect(entry.entryType).toBe('break');
    expect(entry.jobId).toBeNull();
  });
});
