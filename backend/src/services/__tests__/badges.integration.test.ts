// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Badge-service integration tests. Skipped when Postgres isn't reachable,
 * same convention as the punch integration tests.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import {
  bulkIssueBadges,
  getBadgeState,
  issueBadge,
  listBadgeEventsForEmployee,
  revokeBadge,
  verifyBadge,
} from '../badges.js';
import { generateBadgeToken } from '../badge-crypto.js';
import { _resetBadgeLockoutState } from '../kiosk-badge-lockout.js';
import { hashPassword } from '../passwords.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let companyA: number;
let companyB: number;
let actorUserId: number;
let employeeA: number;
let kioskDeviceA: number;
let kioskDeviceB: number;

async function truncate() {
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
}

async function seed() {
  await truncate();
  _resetBadgeLockoutState();

  const [user] = await db('users')
    .insert({
      email: 'badges-test@vibept.local',
      password_hash: await hashPassword('test-passphrase-12345'),
      role_global: 'super_admin',
    })
    .returning<Array<{ id: number }>>('id');
  actorUserId = user!.id;

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
    { company_id: companyB, kiosk_auth_mode: 'both' },
  ]);

  const [ea] = await db('employees')
    .insert({ company_id: companyA, first_name: 'Alice', last_name: 'Alpha', status: 'active' })
    .returning<Array<{ id: number }>>('id');
  await db('employees').insert({
    company_id: companyB,
    first_name: 'Bob',
    last_name: 'Bravo',
    status: 'active',
  });
  employeeA = ea!.id;

  const [da] = await db('kiosk_devices')
    .insert({
      company_id: companyA,
      name: 'Kiosk A',
      token_hash: 'a'.repeat(64),
    })
    .returning<Array<{ id: number }>>('id');
  const [dbb] = await db('kiosk_devices')
    .insert({
      company_id: companyB,
      name: 'Kiosk B',
      token_hash: 'b'.repeat(64),
    })
    .returning<Array<{ id: number }>>('id');
  kioskDeviceA = da!.id;
  kioskDeviceB = dbb!.id;
}

describe.skipIf(!dbReachable)('badges service (DB-backed)', () => {
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

  it('issue → state transitions to active, payload verifies', async () => {
    const state0 = await getBadgeState(companyA, employeeA);
    expect(state0.state).toBe('none');
    expect(state0.version).toBe(0);

    const issued = await issueBadge(companyA, employeeA, actorUserId);
    expect(issued.version).toBe(1);
    expect(issued.payload).toMatch(/^vpt1\./);
    expect(issued.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const state1 = await getBadgeState(companyA, employeeA);
    expect(state1.state).toBe('active');
    expect(state1.version).toBe(1);

    const ctx = await verifyBadge({ id: kioskDeviceA, companyId: companyA }, issued.payload, {
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(ctx.employeeId).toBe(employeeA);
    expect(ctx.sessionToken).toBeTruthy();
  });

  it('reissue invalidates the prior version', async () => {
    const first = await issueBadge(companyA, employeeA, actorUserId);
    const second = await issueBadge(companyA, employeeA, actorUserId);
    expect(second.version).toBe(first.version + 1);

    // Old payload no longer scans.
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, first.payload, {}),
    ).rejects.toThrow();

    // New payload does.
    const ok = await verifyBadge({ id: kioskDeviceA, companyId: companyA }, second.payload, {});
    expect(ok.employeeId).toBe(employeeA);
  });

  it('revoke prevents future scans', async () => {
    const issued = await issueBadge(companyA, employeeA, actorUserId);
    await revokeBadge(companyA, employeeA, actorUserId, 'lost');

    const state = await getBadgeState(companyA, employeeA);
    expect(state.state).toBe('revoked');

    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, issued.payload, {}),
    ).rejects.toThrow();

    const events = await listBadgeEventsForEmployee(companyA, employeeA);
    // Most recent first: scan_failure, revoke, issue.
    expect(events[0]?.eventType).toBe('scan_failure');
    expect(events[1]?.eventType).toBe('revoke');
    expect(events[2]?.eventType).toBe('issue');
  });

  it('rejects a cross-company scan (payload from A scanned on kiosk B)', async () => {
    const issuedA = await issueBadge(companyA, employeeA, actorUserId);
    await expect(
      verifyBadge({ id: kioskDeviceB, companyId: companyB }, issuedA.payload, {}),
    ).rejects.toThrow();
  });

  it('rejects a tampered payload', async () => {
    // Forge a payload with a valid-looking shape but random HMAC.
    const forged =
      'vpt1.' + [companyA, employeeA, 1, 'abcdefgh', 'ZZZZZZZZZZZZZZZZZZZZZZ'].join('.');
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, forged, {}),
    ).rejects.toThrow();
  });

  it('rejects a payload whose version is behind the current badge', async () => {
    await issueBadge(companyA, employeeA, actorUserId); // v1
    await issueBadge(companyA, employeeA, actorUserId); // v2

    // Hand-craft a well-signed v1 payload and try to scan it.
    const stale = generateBadgeToken({
      companyId: companyA,
      employeeId: employeeA,
      badgeVersion: 1,
    });
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, stale.payload, {}),
    ).rejects.toThrow();
  });

  it('bulk issue gives each employee a fresh version', async () => {
    const result = await bulkIssueBadges(companyA, [employeeA], actorUserId);
    expect(result.issued).toHaveLength(1);
    expect(result.issued[0]?.version).toBe(1);

    const again = await bulkIssueBadges(companyA, [employeeA], actorUserId);
    expect(again.issued[0]?.version).toBe(2);
  });

  it('events list returns most recent first', async () => {
    await issueBadge(companyA, employeeA, actorUserId);
    await revokeBadge(companyA, employeeA, actorUserId);
    const events = await listBadgeEventsForEmployee(companyA, employeeA);
    expect(events[0]?.eventType).toBe('revoke');
    expect(events[1]?.eventType).toBe('issue');
  });

  // -------------------------------------------------------------------------
  // Aggressive: concurrency + idempotency
  // -------------------------------------------------------------------------

  it('concurrent issueBadge calls never produce duplicate versions', async () => {
    // Fire 10 parallel issues for the same employee. The per-row FOR UPDATE
    // in issueBadgeTx must serialize them so each gets a distinct,
    // monotonically-increasing version. Promise.all preserves call-order,
    // but the DB commit order is non-deterministic, so the *highest* version
    // may land at any index. Sort before asserting the version sequence.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => issueBadge(companyA, employeeA, actorUserId)),
    );
    const sorted = [...results].sort((a, b) => a.version - b.version);
    expect(sorted.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const state = await getBadgeState(companyA, employeeA);
    expect(state.version).toBe(10);
    expect(state.state).toBe('active');

    // Every version-1..9 payload is invalid; only the v10 payload scans.
    for (const r of sorted.slice(0, -1)) {
      await expect(
        verifyBadge({ id: kioskDeviceA, companyId: companyA }, r.payload, {}),
      ).rejects.toThrow();
    }
    const latest = sorted[sorted.length - 1]!;
    const ok = await verifyBadge({ id: kioskDeviceA, companyId: companyA }, latest.payload, {});
    expect(ok.employeeId).toBe(employeeA);
  });

  it('revoke is idempotent: second call returns same state, logs only once', async () => {
    await issueBadge(companyA, employeeA, actorUserId);
    await revokeBadge(companyA, employeeA, actorUserId, 'first');
    const again = await revokeBadge(companyA, employeeA, actorUserId, 'second');
    expect(again.state).toBe('revoked');

    const events = await listBadgeEventsForEmployee(companyA, employeeA);
    const revokeCount = events.filter((e) => e.eventType === 'revoke').length;
    expect(revokeCount).toBe(1);
  });

  it('issue after revoke mints a fresh version and clears revoked_at', async () => {
    const first = await issueBadge(companyA, employeeA, actorUserId);
    await revokeBadge(companyA, employeeA, actorUserId);
    const reissued = await issueBadge(companyA, employeeA, actorUserId);
    expect(reissued.version).toBe(first.version + 1);

    const state = await getBadgeState(companyA, employeeA);
    expect(state.state).toBe('active');
    expect(state.revokedAt).toBeNull();

    // Old + revoked payload still fails.
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, first.payload, {}),
    ).rejects.toThrow();
  });

  it('refuses to issue a badge to a terminated employee', async () => {
    await db('employees').where({ id: employeeA }).update({ status: 'terminated' });
    await expect(issueBadge(companyA, employeeA, actorUserId)).rejects.toThrow(/terminated/i);
  });

  it('terminating an employee makes their existing badge unscannable without revoke', async () => {
    const issued = await issueBadge(companyA, employeeA, actorUserId);
    await db('employees').where({ id: employeeA }).update({ status: 'terminated' });

    // The employee lookup in verifyBadge filters by status='active', so a
    // terminated employee's still-active-looking badge is rejected.
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, issued.payload, {}),
    ).rejects.toThrow();
  });

  it('bulk issue skips terminated employees and still returns a coherent result', async () => {
    // Add a few more employees to company A.
    const extra = await db('employees')
      .insert([
        { company_id: companyA, first_name: 'Carol', last_name: 'C', status: 'active' },
        { company_id: companyA, first_name: 'Dan', last_name: 'D', status: 'terminated' },
        { company_id: companyA, first_name: 'Eve', last_name: 'E', status: 'active' },
      ])
      .returning<Array<{ id: number }>>('id');
    const ids = [employeeA, ...extra.map((r) => r.id)];
    const result = await bulkIssueBadges(companyA, ids, actorUserId);
    expect(result.issued).toHaveLength(3); // active only
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.reason).toBe('terminated');
    for (const row of result.issued) {
      expect(row.version).toBe(1);
      expect(row.payload).toMatch(/^vpt1\./);
    }
  });

  it('bulk issue with a not-found ID surfaces it in `skipped` without failing the batch', async () => {
    const result = await bulkIssueBadges(companyA, [employeeA, 999_999], actorUserId);
    expect(result.issued.map((r) => r.employeeId)).toEqual([employeeA]);
    expect(result.skipped.map((r) => r.reason)).toContain('not_found');
  });

  it('bulk issue scales to 100 employees in one transaction', async () => {
    const batch: Array<{
      company_id: number;
      first_name: string;
      last_name: string;
      status: 'active';
    }> = [];
    for (let i = 0; i < 100; i++) {
      batch.push({
        company_id: companyA,
        first_name: `F${i}`,
        last_name: `L${i}`,
        status: 'active',
      });
    }
    const inserted = await db('employees').insert(batch).returning<Array<{ id: number }>>('id');
    const ids = inserted.map((r) => r.id);
    const result = await bulkIssueBadges(companyA, ids, actorUserId);
    expect(result.issued).toHaveLength(100);
    expect(new Set(result.issued.map((r) => r.payload)).size).toBe(100);
  });

  it('verifyBadge never leaks employee_id in a cross-company scan_failure audit', async () => {
    // A payload from company A presented on a kiosk paired to company B.
    // The audit row must not attribute a company-B scan to a company-A
    // employee — otherwise listBadgeEventsForEmployee for B would show a
    // phantom row for a B-employee that wasn't involved.
    const issuedA = await issueBadge(companyA, employeeA, actorUserId);
    await expect(
      verifyBadge({ id: kioskDeviceB, companyId: companyB }, issuedA.payload, {}),
    ).rejects.toThrow();

    const rows = await db('badge_events')
      .where({ company_id: companyB })
      .select('event_type', 'employee_id', 'metadata');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('scan_failure');
    expect(rows[0]?.employee_id).toBeNull();
    expect(rows[0]?.metadata).toMatchObject({ reason: 'cross_company' });
  });

  it('rate-limit trip inside verifyBadge produces a scan_failure(reason=rate_limited) audit', async () => {
    _resetBadgeLockoutState();
    const issued = await issueBadge(companyA, employeeA, actorUserId);
    // 20 valid scans should all succeed.
    for (let i = 0; i < 20; i++) {
      await verifyBadge({ id: kioskDeviceA, companyId: companyA }, issued.payload, {});
    }
    // 21st trips the rate limit and rejects — even though the payload is valid.
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, issued.payload, {}),
    ).rejects.toThrow(/too many/i);

    const limited = await db('badge_events')
      .where({ company_id: companyA, event_type: 'scan_failure' })
      .whereRaw(`metadata->>'reason' = ?`, ['rate_limited']);
    expect(limited.length).toBeGreaterThanOrEqual(1);
  });

  it('a malformed payload never performs an employee lookup (cheap-rejection path)', async () => {
    // Capture how many employee rows we have before + confirm no badge_events
    // for company A yet. A bad HMAC should produce exactly ONE scan_failure
    // event and zero employee_id attributions.
    const garbage = 'vpt1.1.1.1.xxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyy';
    await expect(
      verifyBadge({ id: kioskDeviceA, companyId: companyA }, garbage, {}),
    ).rejects.toThrow();

    const rows = await db('badge_events').where({ company_id: companyA });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event_type).toBe('scan_failure');
    expect(rows[0]?.employee_id).toBeNull();
  });

  it('issueBadge + getBadgeState concurrently never returns a partially-written state', async () => {
    // Fire issue() and getBadgeState() in parallel a few times to exercise
    // the read-path during a transactional write. We're checking that
    // getBadgeState never returns `state: "active"` with `version: 0` or
    // a null issuedAt — any intermediate row would be a bug.
    await issueBadge(companyA, employeeA, actorUserId);
    for (let i = 0; i < 5; i++) {
      const [, state] = await Promise.all([
        issueBadge(companyA, employeeA, actorUserId),
        getBadgeState(companyA, employeeA),
      ]);
      if (state.state === 'active') {
        expect(state.version).toBeGreaterThan(0);
        expect(state.issuedAt).not.toBeNull();
      }
    }
  });

  it('listBadgeEventsForEmployee is strictly company-scoped', async () => {
    // Seed a second employee in company B and issue+revoke to generate rows.
    const [b] = await db('employees')
      .insert({
        company_id: companyB,
        first_name: 'Bob',
        last_name: 'B',
        status: 'active',
      })
      .returning<Array<{ id: number }>>('id');
    await issueBadge(companyB, b!.id, actorUserId);
    await revokeBadge(companyB, b!.id, actorUserId);

    // Asking for company A's events for B's id must return [].
    const leak = await listBadgeEventsForEmployee(companyA, b!.id);
    expect(leak).toHaveLength(0);

    // Sanity: asking from the correct company returns the rows.
    const real = await listBadgeEventsForEmployee(companyB, b!.id);
    expect(real.length).toBeGreaterThanOrEqual(2);
  });

  it('getBadgeState is strictly company-scoped', async () => {
    const [b] = await db('employees')
      .insert({
        company_id: companyB,
        first_name: 'Cross',
        last_name: 'Co',
        status: 'active',
      })
      .returning<Array<{ id: number }>>('id');
    // Company A cannot look up a company-B employee's state by ID.
    await expect(getBadgeState(companyA, b!.id)).rejects.toThrow(/not found/i);
  });

  it('revokeBadge refuses when no badge exists', async () => {
    await expect(revokeBadge(companyA, employeeA, actorUserId)).rejects.toThrow(/no badge/i);
  });

  it('issueBadge refuses for an employee in a different company (scoped)', async () => {
    const [b] = await db('employees')
      .insert({ company_id: companyB, first_name: 'W', last_name: 'W', status: 'active' })
      .returning<Array<{ id: number }>>('id');
    await expect(issueBadge(companyA, b!.id, actorUserId)).rejects.toThrow(/not found/i);
  });
});
