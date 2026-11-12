// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Employee-facing timesheet QA fixes (DB-backed, some through the real
 * Express app):
 *
 *   - superseded punches are left out of the timesheet (entries, totals,
 *     approval state), out of approval, and out of the four hours reports
 *   - the timesheet carries firstDay/lastDay, companyTimezone, timeFormat
 *   - /timesheets/current and /timesheets/my-correction-requests honour
 *     the per-company sign-in switch
 *   - an employee edits their own entry only in manual-entry mode
 *     `allowed`
 *   - applyNLCorrection honours the AI switch and the edit/delete matrix,
 *     and refuses datetimes without an offset
 *   - openShiftsForUser hides companies the person can't reach
 *
 * Skipped when Postgres isn't reachable.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { createApp } from '../../http/app.js';
import { applyNLCorrection } from '../ai/nl-correction.js';
import { hashPassword } from '../passwords.js';
import { hoursByJobReport } from '../reports/hours-by-job.js';
import { hoursByPeriodReport } from '../reports/hours-by-period.js';
import { overtimeReport } from '../reports/overtime.js';
import { timeCardReport } from '../reports/time-card.js';
import { openShiftsForUser } from '../time-entries.js';
import { approvePeriod, getTimesheet } from '../timesheets.js';
import { issueAccessToken } from '../tokens.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

const TZ = 'America/Chicago';
// Nov 1 2026 00:00 CDT → Nov 15 2026 00:00 CST (DST ends Nov 1).
const PERIOD_START = new Date('2026-11-01T05:00:00.000Z');
const PERIOD_END = new Date('2026-11-15T06:00:00.000Z');

let baseUrl = '';
let server: { close: (cb?: () => void) => void };

let companyId = 0;
let employeeId = 0;
let employeeUserId = 0;
let supervisorUserId = 0;
let adminUserId = 0;
let jobA = 0;
let empToken = '';

async function seed(): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE
       ai_correction_usage, correction_requests, auth_events, refresh_tokens,
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  const pw = await hashPassword('qa-test-passphrase-12345');
  const mk = async (email: string) => {
    const [u] = await db('users')
      .insert({ email, password_hash: pw, role_global: 'none' })
      .returning<Array<{ id: number }>>('id');
    return Number(u!.id);
  };
  adminUserId = await mk('admin@qa.local');
  supervisorUserId = await mk('sup@qa.local');
  employeeUserId = await mk('emp@qa.local');

  const [c] = await db('companies')
    .insert({
      name: 'QA Co',
      slug: 'qa-co',
      timezone: TZ,
      pay_period_type: 'bi_weekly',
      is_internal: true,
    })
    .returning<Array<{ id: number }>>('id');
  companyId = Number(c!.id);
  await db('company_settings').insert({
    company_id: companyId,
    allow_self_approve: true,
    employee_manual_entry_mode: 'allowed',
    ai_enabled: true,
    time_format_default: 'decimal',
  });
  await db('company_memberships').insert([
    { user_id: adminUserId, company_id: companyId, role: 'company_admin' },
    { user_id: supervisorUserId, company_id: companyId, role: 'supervisor' },
    { user_id: employeeUserId, company_id: companyId, role: 'employee' },
  ]);
  const [e] = await db('employees')
    .insert({
      company_id: companyId,
      user_id: employeeUserId,
      first_name: 'Emp',
      last_name: 'Loyee',
      status: 'active',
    })
    .returning<Array<{ id: number }>>('id');
  employeeId = Number(e!.id);
  const [j] = await db('jobs')
    .insert({ company_id: companyId, code: 'A', name: 'Job A' })
    .returning<Array<{ id: number }>>('id');
  jobA = Number(j!.id);

  empToken = issueAccessToken({
    id: employeeUserId,
    email: 'emp@qa.local',
    roleGlobal: 'none',
  }).token;
}

async function insertEntry(opts: {
  start: string;
  end: string | null;
  source?: 'web' | 'web_manual';
  approved?: boolean;
}): Promise<number> {
  const start = new Date(opts.start);
  const end = opts.end ? new Date(opts.end) : null;
  const [row] = await db('time_entries')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      shift_id: randomUUID(),
      entry_type: 'work',
      job_id: jobA,
      started_at: start,
      ended_at: end,
      duration_seconds: end ? Math.round((end.getTime() - start.getTime()) / 1000) : null,
      source: opts.source ?? 'web',
      entry_reason: opts.source === 'web_manual' ? 'Forgot to punch' : null,
      approved_at: opts.approved ? new Date() : null,
      approved_by: opts.approved ? adminUserId : null,
    })
    .returning<Array<{ id: number }>>('id');
  return Number(row!.id);
}

/** 8h punch on Tue Nov 3, superseded by a 4h manual entry. */
async function seedSuperseded(opts: { manualApproved?: boolean } = {}) {
  const punch = await insertEntry({
    start: '2026-11-03T14:00:00Z',
    end: '2026-11-03T22:00:00Z',
  });
  const manual = await insertEntry({
    start: '2026-11-03T14:00:00Z',
    end: '2026-11-03T18:00:00Z',
    source: 'web_manual',
    approved: opts.manualApproved ?? false,
  });
  await db('time_entries').where({ id: punch }).update({ superseded_by_entry_id: manual });
  await db('time_entries')
    .where({ id: manual })
    .update({ supersedes_entry_ids: [punch] });
  return { punch, manual };
}

async function collect(it: AsyncIterable<Record<string, unknown>>) {
  const out: Array<Record<string, unknown>> = [];
  for await (const r of it) out.push(r);
  return out;
}

async function api(
  path: string,
  opts: { method?: string; bearer?: string; body?: unknown } = {},
): Promise<{ status: number; body: { data?: unknown; error?: { message?: string } } | null }> {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

describe.skipIf(!dbReachable)('employee timesheet QA fixes', () => {
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
  // Superseded punches
  // -------------------------------------------------------------------

  it('getTimesheet leaves superseded punches out of entries and totals', async () => {
    const { punch, manual } = await seedSuperseded();
    const sheet = await getTimesheet(companyId, employeeId, {
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(sheet.entries.map((e) => e.id)).toEqual([manual]);
    expect(sheet.entries.some((e) => e.id === punch)).toBe(false);
    expect(sheet.totals.workSeconds).toBe(4 * 3600);
  });

  it('a superseded unapproved punch does not keep the period unapproved', async () => {
    await seedSuperseded({ manualApproved: true });
    const sheet = await getTimesheet(companyId, employeeId, {
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(sheet.isApproved).toBe(true);
    expect(sheet.approvedAt).not.toBeNull();
  });

  it('approvePeriod stamps the active entry, not the superseded punch', async () => {
    const { punch, manual } = await seedSuperseded();
    const res = await approvePeriod(
      companyId,
      { userId: adminUserId, roleGlobal: 'none' },
      {
        periodStart: PERIOD_START.toISOString(),
        periodEnd: PERIOD_END.toISOString(),
        employeeIds: [employeeId],
      },
    );
    expect(res.approvedEntryCount).toBe(1);
    const rows = await db('time_entries')
      .whereIn('id', [punch, manual])
      .select<Array<{ id: number; approved_at: Date | null }>>('id', 'approved_at');
    expect(rows.find((r) => Number(r.id) === manual)?.approved_at).not.toBeNull();
    expect(rows.find((r) => Number(r.id) === punch)?.approved_at).toBeNull();
  });

  it('hours reports count only the active entry', async () => {
    await seedSuperseded();
    const period = {
      periodStart: PERIOD_START.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
    };

    const byPeriod = await collect(hoursByPeriodReport.rows(companyId, period));
    expect(byPeriod.find((r) => r.lastName === 'Loyee')?.workSeconds).toBe(4 * 3600);

    const byJob = await collect(hoursByJobReport.rows(companyId, period));
    expect(byJob.find((r) => r.jobCode === 'A')?.workSeconds).toBe(4 * 3600);

    const card = await collect(timeCardReport.rows(companyId, { employeeId, ...period }));
    const entryRows = card.filter((r) => r.type === 'work');
    expect(entryRows).toHaveLength(1);
    expect(card.find((r) => r.type === 'TOTAL')?.durationSeconds).toBe(4 * 3600);

    const ot = await collect(
      overtimeReport.rows(companyId, {
        referenceDate: '2026-11-04T18:00:00.000Z',
        approachingThreshold: 1,
      }),
    );
    expect(ot.find((r) => r.lastName === 'Loyee')?.workSeconds).toBe(4 * 3600);
  });

  it('timesheet carries civil period days, company timezone and viewer format', async () => {
    await db('users').where({ id: employeeUserId }).update({ time_format_preference: 'hhmm' });
    const sheet = await getTimesheet(companyId, employeeId, {
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      viewerUserId: employeeUserId,
    });
    expect(sheet.period.firstDay).toBe('2026-11-01');
    expect(sheet.period.lastDay).toBe('2026-11-14');
    expect(sheet.companyTimezone).toBe(TZ);
    expect(sheet.timeFormat).toBe('hhmm');

    const asAdmin = await getTimesheet(companyId, employeeId, {
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      viewerUserId: adminUserId,
    });
    expect(asAdmin.timeFormat).toBe('decimal');
  });

  // -------------------------------------------------------------------
  // Sign-in switch on self-service routes
  // -------------------------------------------------------------------

  it('/timesheets/current refuses when sign-in is switched off', async () => {
    const ok = await api(`/timesheets/current?companyId=${companyId}`, { bearer: empToken });
    expect(ok.status).toBe(200);

    await db('employees').where({ id: employeeId }).update({ login_disabled_at: db.fn.now() });
    const blocked = await api(`/timesheets/current?companyId=${companyId}`, { bearer: empToken });
    expect(blocked.status).toBe(403);
  });

  it('/timesheets/my-correction-requests refuses when sign-in is switched off', async () => {
    await db('employees').where({ id: employeeId }).update({ login_disabled_at: db.fn.now() });
    const blocked = await api(`/timesheets/my-correction-requests?companyId=${companyId}`, {
      bearer: empToken,
    });
    expect(blocked.status).toBe(403);
  });

  // -------------------------------------------------------------------
  // Employee direct edit follows employee_manual_entry_mode
  // -------------------------------------------------------------------

  it('employee PATCH of own entry: 403 when mode is disabled, 200 when allowed', async () => {
    const id = await insertEntry({ start: '2026-11-03T14:00:00Z', end: '2026-11-03T22:00:00Z' });
    const patch = () =>
      api(`/timesheets/entries/${id}?companyId=${companyId}`, {
        method: 'PATCH',
        bearer: empToken,
        body: { endedAt: '2026-11-03T21:30:00.000Z', reason: 'Left early' },
      });

    await db('company_settings')
      .where({ company_id: companyId })
      .update({ employee_manual_entry_mode: 'disabled' });
    const refused = await patch();
    expect(refused.status).toBe(403);
    expect(refused.body?.error?.message).toMatch(/Request fix/);

    await db('company_settings')
      .where({ company_id: companyId })
      .update({ employee_manual_entry_mode: 'override_only' });
    expect((await patch()).status).toBe(403);

    await db('company_settings')
      .where({ company_id: companyId })
      .update({ employee_manual_entry_mode: 'allowed' });
    expect((await patch()).status).toBe(200);
  });

  // -------------------------------------------------------------------
  // AI natural-language correction apply
  // -------------------------------------------------------------------

  const empActor = () => ({ userId: employeeUserId, companyId, roleGlobal: 'none' as const });

  it('applyNLCorrection refuses when AI is switched off', async () => {
    const id = await insertEntry({ start: '2026-11-03T14:00:00Z', end: '2026-11-03T22:00:00Z' });
    await db('company_settings').where({ company_id: companyId }).update({ ai_enabled: false });
    await expect(
      applyNLCorrection(empActor(), {
        employeeId,
        originalPrompt: 'I left at 4',
        toolCalls: [
          {
            id: 't1',
            name: 'edit_entry',
            arguments: { entryId: id, endedAt: '2026-11-03T15:00:00-06:00' },
            summary: 'x',
          },
        ],
      }),
    ).rejects.toThrow(/AI features are disabled/);
    const row = await db('time_entries').where({ id }).first<{ ended_at: Date }>();
    expect(row.ended_at.toISOString()).toBe('2026-11-03T22:00:00.000Z');
  });

  it('applyNLCorrection: employee cannot edit an approved entry', async () => {
    const id = await insertEntry({
      start: '2026-11-03T14:00:00Z',
      end: '2026-11-03T22:00:00Z',
      approved: true,
    });
    const res = await applyNLCorrection(empActor(), {
      employeeId,
      originalPrompt: 'I left at 4',
      toolCalls: [
        {
          id: 't1',
          name: 'edit_entry',
          arguments: { entryId: id, endedAt: '2026-11-03T15:00:00-06:00' },
          summary: 'x',
        },
      ],
    });
    expect(res.applied).toBe(0);
    expect(res.skipped).toBe(1);
    const row = await db('time_entries').where({ id }).first<{ ended_at: Date }>();
    expect(row.ended_at.toISOString()).toBe('2026-11-03T22:00:00.000Z');
  });

  it('applyNLCorrection: employee edit follows the manual-entry mode', async () => {
    const id = await insertEntry({ start: '2026-11-03T14:00:00Z', end: '2026-11-03T22:00:00Z' });
    await db('company_settings')
      .where({ company_id: companyId })
      .update({ employee_manual_entry_mode: 'disabled' });
    const call = {
      id: 't1',
      name: 'edit_entry' as const,
      arguments: { entryId: id, endedAt: '2026-11-03T15:00:00-06:00' },
      summary: 'x',
    };
    const refused = await applyNLCorrection(empActor(), {
      employeeId,
      originalPrompt: 'I left at 4',
      toolCalls: [call],
    });
    expect(refused.applied).toBe(0);
    expect(refused.errors[0]?.message).toMatch(/Request fix/);

    await db('company_settings')
      .where({ company_id: companyId })
      .update({ employee_manual_entry_mode: 'allowed' });
    const ok = await applyNLCorrection(empActor(), {
      employeeId,
      originalPrompt: 'I left at 4',
      toolCalls: [call],
    });
    expect(ok.applied).toBe(1);
    const row = await db('time_entries').where({ id }).first<{ ended_at: Date }>();
    // 15:00 CST = 21:00Z
    expect(row.ended_at.toISOString()).toBe('2026-11-03T21:00:00.000Z');
  });

  it('applyNLCorrection: only admins may delete', async () => {
    const deleteCall = (id: number) => ({
      employeeId,
      originalPrompt: 'delete it',
      toolCalls: [
        { id: 't1', name: 'delete_entry' as const, arguments: { entryId: id }, summary: 'x' },
      ],
    });
    const id = await insertEntry({ start: '2026-11-03T14:00:00Z', end: '2026-11-03T22:00:00Z' });

    const asEmp = await applyNLCorrection(empActor(), deleteCall(id));
    expect(asEmp.applied).toBe(0);
    const asSup = await applyNLCorrection(
      { userId: supervisorUserId, companyId, roleGlobal: 'none' },
      deleteCall(id),
    );
    expect(asSup.applied).toBe(0);
    let row = await db('time_entries').where({ id }).first<{ deleted_at: Date | null }>();
    expect(row.deleted_at).toBeNull();

    const asAdmin = await applyNLCorrection(
      { userId: adminUserId, companyId, roleGlobal: 'none' },
      deleteCall(id),
    );
    expect(asAdmin.applied).toBe(1);
    row = await db('time_entries').where({ id }).first<{ deleted_at: Date | null }>();
    expect(row.deleted_at).not.toBeNull();
  });

  it('applyNLCorrection rejects datetimes without an offset', async () => {
    const id = await insertEntry({ start: '2026-11-03T14:00:00Z', end: '2026-11-03T22:00:00Z' });
    const res = await applyNLCorrection(
      { userId: adminUserId, companyId, roleGlobal: 'none' },
      {
        employeeId,
        originalPrompt: 'left at 4',
        toolCalls: [
          {
            id: 't1',
            name: 'edit_entry',
            arguments: { entryId: id, endedAt: '2026-11-03T16:00:00' },
            summary: 'x',
          },
        ],
      },
    );
    expect(res.applied).toBe(0);
    expect(res.errors[0]?.message).toMatch(/offset/);
  });

  // -------------------------------------------------------------------
  // Open shifts across companies
  // -------------------------------------------------------------------

  it('openShiftsForUser hides blocked, inactive and disabled companies', async () => {
    await insertEntry({ start: '2026-11-03T14:00:00Z', end: null });
    expect(await openShiftsForUser(employeeUserId)).toHaveLength(1);

    await db('employees').where({ id: employeeId }).update({ login_disabled_at: db.fn.now() });
    expect(await openShiftsForUser(employeeUserId)).toHaveLength(0);
    await db('employees').where({ id: employeeId }).update({ login_disabled_at: null });

    await db('employees').where({ id: employeeId }).update({ status: 'terminated' });
    expect(await openShiftsForUser(employeeUserId)).toHaveLength(0);
    await db('employees').where({ id: employeeId }).update({ status: 'active' });

    await db('companies').where({ id: companyId }).update({ disabled_at: db.fn.now() });
    expect(await openShiftsForUser(employeeUserId)).toHaveLength(0);
  });
});
