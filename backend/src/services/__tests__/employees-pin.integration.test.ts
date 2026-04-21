/**
 * PIN encryption + manual-set integration tests.
 *
 * Exercises the real DB so the encrypt/decrypt round-trip and
 * fingerprint-collision path hit production code.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { decryptSecret } from '../crypto.js';
import {
  createEmployee,
  getEmployee,
  listEmployees,
  regeneratePin,
  setEmployeePinManually,
} from '../employees.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

async function wipe() {
  await db.raw(
    `TRUNCATE TABLE
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies
     RESTART IDENTITY CASCADE`,
  );
}

let companyId: number;

async function seed() {
  await wipe();
  const [company] = await db('companies')
    .insert({
      name: 'Test Co',
      slug: 'test-pin',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: true,
      license_state: 'internal_free',
    })
    .returning<Array<{ id: number }>>('id');
  companyId = company!.id;
  await db('company_settings').insert({ company_id: companyId, allow_self_approve: true });
}

beforeAll(async () => {
  await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
  if (!dbReachable) return;
  await runMigrations();
});

beforeEach(async () => {
  if (!dbReachable) return;
  await seed();
});

afterAll(async () => {
  if (dbReachable) await db.destroy();
});

describe.skipIf(!dbReachable)('employee PINs encrypt-at-rest', () => {
  it('createEmployee with generatePin stores pin_encrypted', async () => {
    const res = await createEmployee(companyId, {
      firstName: 'Alice',
      lastName: 'A',
      generatePin: true,
      pinLength: 6,
    });
    expect(res.plaintextPin).toBeTruthy();

    const row = await db('employees').where({ id: res.employee.id }).first();
    expect(row.pin_encrypted).toBeTruthy();
    expect(decryptSecret(row.pin_encrypted)).toBe(res.plaintextPin);
  });

  it('getEmployee without includePin never leaks the PIN', async () => {
    const created = await createEmployee(companyId, {
      firstName: 'B',
      lastName: 'B',
      generatePin: true,
      pinLength: 6,
    });
    const got = await getEmployee(companyId, created.employee.id);
    expect(got.pin).toBeNull();
    expect(got.hasPin).toBe(true);
  });

  it('getEmployee with includePin returns the decrypted PIN', async () => {
    const created = await createEmployee(companyId, {
      firstName: 'C',
      lastName: 'C',
      generatePin: true,
      pinLength: 6,
    });
    const got = await getEmployee(companyId, created.employee.id, { includePin: true });
    expect(got.pin).toBe(created.plaintextPin);
  });

  it('listEmployees with includePin decrypts every row', async () => {
    await createEmployee(companyId, {
      firstName: 'D',
      lastName: 'D',
      generatePin: true,
      pinLength: 4,
    });
    await createEmployee(companyId, {
      firstName: 'E',
      lastName: 'E',
      generatePin: true,
      pinLength: 6,
    });
    const rows = await listEmployees(companyId, { includePin: true });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.pin).toMatch(/^\d{4,6}$/);
    }
  });

  it('regeneratePin overwrites pin_encrypted with the new value', async () => {
    const created = await createEmployee(companyId, {
      firstName: 'F',
      lastName: 'F',
      generatePin: true,
      pinLength: 6,
    });
    const regen = await regeneratePin(companyId, created.employee.id);
    expect(regen.plaintextPin).not.toBe(created.plaintextPin);

    const got = await getEmployee(companyId, created.employee.id, { includePin: true });
    expect(got.pin).toBe(regen.plaintextPin);
  });

  it('setEmployeePinManually validates shape + weak patterns', async () => {
    const created = await createEmployee(companyId, {
      firstName: 'G',
      lastName: 'G',
      generatePin: false,
      pinLength: 6,
    });

    await expect(setEmployeePinManually(companyId, created.employee.id, '12')).rejects.toThrow(
      /4–6 digits/,
    );
    await expect(setEmployeePinManually(companyId, created.employee.id, '1234')).rejects.toThrow(
      /weak/i,
    );
    await expect(setEmployeePinManually(companyId, created.employee.id, '1111')).rejects.toThrow(
      /weak/i,
    );
    await expect(setEmployeePinManually(companyId, created.employee.id, 'abcd')).rejects.toThrow(
      /digits/i,
    );
  });

  it('setEmployeePinManually stores + exposes the chosen PIN', async () => {
    const created = await createEmployee(companyId, {
      firstName: 'H',
      lastName: 'H',
      generatePin: false,
      pinLength: 6,
    });

    const res = await setEmployeePinManually(companyId, created.employee.id, '839274');
    expect(res.plaintextPin).toBe('839274');
    expect(res.employee.pin).toBe('839274');

    // Round-trip: decrypt directly from the DB row.
    const row = await db('employees').where({ id: created.employee.id }).first();
    expect(decryptSecret(row.pin_encrypted)).toBe('839274');
  });

  it('setEmployeePinManually rejects PIN already used by another active employee', async () => {
    const one = await createEmployee(companyId, {
      firstName: 'I1',
      lastName: 'I',
      generatePin: false,
      pinLength: 6,
    });
    const two = await createEmployee(companyId, {
      firstName: 'I2',
      lastName: 'I',
      generatePin: false,
      pinLength: 6,
    });
    await setEmployeePinManually(companyId, one.employee.id, '428391');
    await expect(setEmployeePinManually(companyId, two.employee.id, '428391')).rejects.toThrow(
      /already has that PIN/,
    );
  });

  it('terminating an employee clears pin_encrypted so a new active employee can reuse the PIN', async () => {
    const created = await createEmployee(companyId, {
      firstName: 'J',
      lastName: 'J',
      generatePin: false,
      pinLength: 6,
    });
    await setEmployeePinManually(companyId, created.employee.id, '527183');

    // Terminate — updateEmployee via service: just set status. We use
    // raw DB here since updateEmployee is tested elsewhere and this
    // just confirms pin_encrypted gets cleared.
    const { updateEmployee } = await import('../employees.js');
    await updateEmployee(companyId, created.employee.id, { status: 'terminated' });

    const row = await db('employees').where({ id: created.employee.id }).first();
    expect(row.pin_hash).toBeNull();
    expect(row.pin_fingerprint).toBeNull();
    expect(row.pin_encrypted).toBeNull();
  });
});
