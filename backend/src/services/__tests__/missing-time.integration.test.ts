// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Missing-time reminders.
 *
 * Covers:
 *   - which days count as missing: company work days, a per-employee
 *     override, the hire date, any entry (punch or time off) covering a
 *     day, and only days before today
 *   - who is left out: approved period, kiosk-only, opted out
 *   - a manual send reminds only the eligible and records each reminder
 *   - the hourly sweep acts only in the company's hour, sends once a day,
 *     stops at the cap, and emails the managers one summary
 *
 * "Now" is fixed at Wed 2026-10-28 10:00 in Chicago. Pay periods are
 * weekly from Sunday, so the previous period is Sun 10/18 – Sat 10/24.
 *
 * Skipped when Postgres isn't reachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { getCompanySettings, updateCompanySettings } from '../company-settings.js';
import { updateEmployee } from '../employees.js';
import {
  getMissingTimeReport,
  missingDaysFor,
  runMissingTimeSweep,
  sendMissingTimeReminders,
} from '../missing-time.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

const NOW = new Date('2026-10-28T15:00:00Z'); // Wed 10:00 CDT
const DAY = 86_400_000;

let companyId = 0;
let adminUserId = 0;
const emp: Record<string, number> = {};

async function addEmployee(
  key: string,
  fields: Record<string, unknown> = {},
  withUser = true,
): Promise<void> {
  let userId: number | null = null;
  if (withUser) {
    const [u] = await db('users')
      .insert({ email: `${key}@vibept.local`, password_hash: 'x', role_global: 'none' })
      .returning<Array<{ id: number }>>('id');
    userId = u!.id;
    await db('company_memberships').insert({
      user_id: userId,
      company_id: companyId,
      role: 'employee',
    });
  }
  const [e] = await db('employees')
    .insert({
      company_id: companyId,
      user_id: userId,
      first_name: key,
      last_name: 'Test',
      email: `${key}@vibept.local`,
      status: 'active',
      ...fields,
    })
    .returning<Array<{ id: number }>>('id');
  emp[key] = e!.id;
}

/** A closed 8-hour work entry starting at 9:00 Chicago on `day`. */
async function work(key: string, day: string, extra: Record<string, unknown> = {}) {
  const started = new Date(`${day}T14:00:00Z`);
  await db('time_entries').insert({
    company_id: companyId,
    employee_id: emp[key],
    shift_id: randomUUID(),
    entry_type: 'work',
    started_at: started,
    ended_at: new Date(started.getTime() + 8 * 3_600_000),
    duration_seconds: 8 * 3600,
    source: 'web',
    ...extra,
  });
}

async function seed() {
  await db.raw(
    `TRUNCATE TABLE
       missing_time_reminders, notifications_log, time_entry_audit, time_entries,
       jobs, employees, company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  const [company] = await db('companies')
    .insert({
      name: 'Acme',
      slug: 'acme',
      timezone: 'America/Chicago',
      pay_period_type: 'weekly',
      week_start_day: 0,
    })
    .returning<Array<{ id: number }>>('id');
  companyId = company!.id;
  await db('company_settings').insert({ company_id: companyId });
  const [admin] = await db('users')
    .insert({ email: 'admin@vibept.local', password_hash: 'x', role_global: 'none' })
    .returning<Array<{ id: number }>>('id');
  adminUserId = admin!.id;
  await db('company_memberships').insert({
    user_id: adminUserId,
    company_id: companyId,
    role: 'company_admin',
  });

  // ann: worked Mon, PTO-style manual entry Tue → missing Wed–Fri.
  await addEmployee('ann');
  await work('ann', '2026-10-19');
  await work('ann', '2026-10-20', { source: 'web_manual', entry_reason: 'Time off' });
  // A deleted entry doesn't cover its day.
  await work('ann', '2026-10-21', { deleted_at: new Date() });
  // kim: no account → kiosk-only.
  await addEmployee('kim', {}, false);
  // otto: opted out.
  await addEmployee('otto', { missing_time_reminders_enabled: false });
  // hal: hired Thursday → only Thu, Fri.
  await addEmployee('hal', { hired_at: '2026-10-22' });
  // sam: works Saturdays only.
  await addEmployee('sam', { work_days: [6] });
  // pat: the period is approved.
  await addEmployee('pat');
  await work('pat', '2026-10-19', { approved_at: new Date(), approved_by: adminUserId });
  // fay: every weekday covered → not listed.
  await addEmployee('fay');
  for (const d of ['19', '20', '21', '22', '23']) await work('fay', `2026-10-${d}`);
}

function byKey(report: Awaited<ReturnType<typeof getMissingTimeReport>>) {
  return Object.fromEntries(
    Object.entries(emp).map(([k, id]) => [k, report.employees.find((e) => e.employeeId === id)]),
  );
}

describe('missingDaysFor', () => {
  const days = [
    { iso: '2026-10-18', dow: 0 },
    { iso: '2026-10-19', dow: 1 },
    { iso: '2026-10-20', dow: 2 },
    { iso: '2026-10-21', dow: 3 },
  ];
  it('keeps expected, uncovered days before today and from the hire date', () => {
    expect(
      missingDaysFor({
        days,
        todayIso: '2026-10-21',
        workDays: [1, 2, 3],
        hiredOn: '2026-10-20',
        coveredDays: new Set(),
      }),
    ).toEqual(['2026-10-20']);
    expect(
      missingDaysFor({
        days,
        todayIso: '2026-10-22',
        workDays: [0, 1, 2, 3],
        hiredOn: null,
        coveredDays: new Set(['2026-10-19', '2026-10-21']),
      }),
    ).toEqual(['2026-10-18', '2026-10-20']);
  });
});

describe.skipIf(!dbReachable)('missing-time reminders (DB-backed)', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(seed);

  it('finds missing days in the previous period and says who can be reminded', async () => {
    const report = await getMissingTimeReport(companyId, 'previous', NOW);
    expect(report.period).toEqual({ which: 'previous', start: '2026-10-18', end: '2026-10-24' });
    expect(report.checkedThrough).toBe('2026-10-24');

    const r = byKey(report);
    expect(r.ann).toMatchObject({
      missingDates: ['2026-10-21', '2026-10-22', '2026-10-23'],
      skipReason: null,
    });
    expect(r.kim?.skipReason).toBe('kiosk_only');
    expect(r.otto?.skipReason).toBe('opted_out');
    expect(r.hal?.missingDates).toEqual(['2026-10-22', '2026-10-23']);
    expect(r.sam?.missingDates).toEqual(['2026-10-24']);
    expect(r.pat?.skipReason).toBe('approved');
    expect(r.fay).toBeUndefined();
  });

  it('saves work days and the reminder switch on settings and employees', async () => {
    const settings = await updateCompanySettings(companyId, {
      missingTimeRemindersEnabled: true,
      workDays: [1, 3, 5],
      missingTimeReminderHour: 7,
      missingTimeReminderMax: 4,
    });
    expect(settings).toMatchObject({
      missingTimeRemindersEnabled: true,
      workDays: [1, 3, 5],
      missingTimeReminderHour: 7,
      missingTimeReminderMax: 4,
    });
    expect((await getCompanySettings(companyId)).workDays).toEqual([1, 3, 5]);

    const updated = await updateEmployee(companyId, emp.ann!, {
      workDays: [2, 4],
      missingTimeRemindersEnabled: false,
      hiredAt: '2026-10-19',
    });
    expect(updated).toMatchObject({
      workDays: [2, 4],
      missingTimeRemindersEnabled: false,
      hiredAt: '2026-10-19',
    });
    const reset = await updateEmployee(companyId, emp.ann!, { workDays: null });
    expect(reset.workDays).toBeNull();
  });

  it('checks the current period only up to yesterday', async () => {
    const report = await getMissingTimeReport(companyId, 'current', NOW);
    expect(report.period).toMatchObject({ start: '2026-10-25', end: '2026-10-31' });
    expect(report.checkedThrough).toBe('2026-10-27');
    expect(byKey(report).ann?.missingDates).toEqual(['2026-10-26', '2026-10-27']);
  });

  it('sends manual reminders only to eligible employees and records them', async () => {
    const res = await sendMissingTimeReminders(
      companyId,
      adminUserId,
      'previous',
      [emp.ann!, emp.kim!, emp.fay!],
      NOW,
    );
    expect(res.sent).toBe(1);
    expect(res.skipped).toEqual([
      { employeeId: emp.kim, reason: 'kiosk_only' },
      { employeeId: emp.fay, reason: 'no_missing_days' },
    ]);
    const rows = await db('missing_time_reminders').where({ company_id: companyId });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      employee_id: emp.ann,
      kind: 'employee',
      trigger: 'manual',
      sent_by: adminUserId,
      missing_dates: ['2026-10-21', '2026-10-22', '2026-10-23'],
    });
    const log = await db('notifications_log').where({
      recipient_id: emp.ann,
      type: 'missing_time_reminder',
    });
    expect(log.length).toBeGreaterThan(0);

    const after = await getMissingTimeReport(companyId, 'previous', NOW);
    expect(byKey(after).ann?.remindersSent).toBe(1);
  });

  it('sweeps once a day in the company hour, up to the cap, with one manager summary', async () => {
    // Off by default.
    expect(await runMissingTimeSweep(NOW)).toBe(0);

    await db('company_settings')
      .where({ company_id: companyId })
      .update({ missing_time_reminders_enabled: true, missing_time_reminder_hour: 9 });
    expect(await runMissingTimeSweep(NOW)).toBe(0); // 10:00 local, not 9

    await db('company_settings')
      .where({ company_id: companyId })
      .update({ missing_time_reminder_hour: 10, missing_time_reminder_max: 2 });
    // ann, hal, sam — not kim (kiosk), otto (opted out), pat (approved).
    expect(await runMissingTimeSweep(NOW)).toBe(3);
    expect(await runMissingTimeSweep(NOW)).toBe(0); // same day again

    const summaries = await db('notifications_log').where({
      recipient_id: adminUserId,
      type: 'missing_time_summary',
    });
    expect(summaries).toHaveLength(1);

    // Day two: ann fixes Wed–Fri, the others are reminded again.
    for (const d of ['21', '22', '23']) await work('ann', `2026-10-${d}`);
    expect(await runMissingTimeSweep(new Date(NOW.getTime() + DAY))).toBe(2);
    // Day three: cap of 2 reached.
    expect(await runMissingTimeSweep(new Date(NOW.getTime() + 2 * DAY))).toBe(0);

    // Approval stops reminders too.
    await db('company_settings')
      .where({ company_id: companyId })
      .update({ missing_time_reminder_max: 5 });
    await work('hal', '2026-10-22', { approved_at: new Date(), approved_by: adminUserId });
    expect(await runMissingTimeSweep(new Date(NOW.getTime() + 3 * DAY))).toBe(1); // sam only
  });
});
