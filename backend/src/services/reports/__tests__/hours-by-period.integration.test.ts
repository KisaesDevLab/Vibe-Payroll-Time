// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Hours by pay period: department subtotals and the grand total.
 *
 *   - employees group by department (case-insensitive), A–Z, with
 *     "No department" last, each group followed by a SUBTOTAL row
 *   - the TOTAL row sums every employee row
 *   - with no departments at all there are no SUBTOTAL rows
 *
 * Skipped when Postgres isn't reachable.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../db/knex.js';
import { runMigrations } from '../../../db/migrate.js';
import { listEmployees } from '../../employees.js';
import { hoursByPeriodReport } from '../hours-by-period.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

const PERIOD = { periodStart: '2026-10-18T00:00:00.000Z', periodEnd: '2026-10-25T00:00:00.000Z' };
let companyId = 0;

async function addEmployee(last: string, department: string | null, hours: number) {
  const [e] = await db('employees')
    .insert({
      company_id: companyId,
      first_name: 'Pat',
      last_name: last,
      department,
      status: 'active',
    })
    .returning<Array<{ id: number }>>('id');
  const started = new Date('2026-10-20T14:00:00Z');
  await db('time_entries').insert({
    company_id: companyId,
    employee_id: e!.id,
    shift_id: randomUUID(),
    entry_type: 'work',
    started_at: started,
    ended_at: new Date(started.getTime() + hours * 3_600_000),
    duration_seconds: hours * 3600,
    source: 'web',
  });
}

async function run(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for await (const row of hoursByPeriodReport.rows(companyId, PERIOD)) {
    rows.push(row as Record<string, unknown>);
  }
  return rows;
}

const hours = (r: Record<string, unknown>) => Number(r.workSeconds) / 3600;

describe.skipIf(!dbReachable)('hours by pay period: departments (DB-backed)', () => {
  beforeAll(async () => {
    await (await import('../../__tests__/__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
  });
  afterAll(async () => {
    await db.destroy().catch(() => undefined);
  });
  beforeEach(async () => {
    await db.raw(
      `TRUNCATE TABLE time_entry_audit, time_entries, jobs, employees,
         company_memberships, company_settings, companies, users RESTART IDENTITY CASCADE`,
    );
    const [c] = await db('companies')
      .insert({ name: 'Acme', slug: 'acme', timezone: 'UTC', pay_period_type: 'weekly' })
      .returning<Array<{ id: number }>>('id');
    companyId = c!.id;
    await db('company_settings').insert({ company_id: companyId });
  });

  it('subtotals each department and ends with the grand total', async () => {
    await addEmployee('Avery', 'Tax', 8);
    await addEmployee('Blake', null, 5);
    await addEmployee('Casey', 'Admin', 6);
    await addEmployee('Drew', 'tax ', 4); // same department, different spelling

    const rows = await run();
    expect(rows.map((r) => [r.department, r.lastName, hours(r)])).toEqual([
      ['Admin', 'Casey', 6],
      ['Admin', 'SUBTOTAL', 6],
      ['Tax', 'Avery', 8],
      ['tax', 'Drew', 4],
      ['Tax', 'SUBTOTAL', 12],
      ['', 'Blake', 5],
      ['No department', 'SUBTOTAL', 5],
      ['', 'TOTAL', 23],
    ]);
    expect(rows.find((r) => r.department === 'Tax' && r.lastName === 'SUBTOTAL')?.firstName).toBe(
      '2 employees',
    );
    expect(rows[rows.length - 1]?.firstName).toBe('4 employees');
  });

  it('shows only the grand total when nobody has a department', async () => {
    await addEmployee('Avery', null, 8);
    await addEmployee('Blake', null, 5);
    const rows = await run();
    expect(rows.map((r) => r.lastName)).toEqual(['Avery', 'Blake', 'TOTAL']);
    expect(hours(rows[2]!)).toBe(13);
  });

  it('finds employees by department in the roster search', async () => {
    await addEmployee('Avery', 'Tax', 8);
    await addEmployee('Blake', 'Admin', 5);
    const found = await listEmployees(companyId, { search: 'tax' });
    expect(found.map((e) => [e.lastName, e.department])).toEqual([['Avery', 'Tax']]);
  });
});
