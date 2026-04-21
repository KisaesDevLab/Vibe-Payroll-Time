// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type {
  CreateEmployeeRequest,
  CsvImportResponse,
  Employee,
  EmployeeWithPinResponse,
  UpdateEmployeeRequest,
} from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { pinFingerprint } from './crypto.js';
import { decryptSecret, encryptSecret } from './crypto.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';
import { normalizeToE164 } from './notifications/phone-verification.js';
import { hashPin } from './passwords.js';
import { generatePinMaterial, validatePinShape } from './pin-generator.js';

interface EmployeeRow {
  id: number;
  company_id: number;
  user_id: number | null;
  first_name: string;
  last_name: string;
  employee_number: string | null;
  email: string | null;
  phone: string | null;
  pin_hash: string | null;
  pin_fingerprint: string | null;
  pin_encrypted: string | null;
  status: Employee['status'];
  hired_at: string | null;
  terminated_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToEmployee(row: EmployeeRow, opts: { includePin?: boolean } = {}): Employee {
  const base: Employee = {
    id: row.id,
    companyId: row.company_id,
    userId: row.user_id,
    firstName: row.first_name,
    lastName: row.last_name,
    employeeNumber: row.employee_number,
    email: row.email,
    phone: row.phone,
    status: row.status,
    hiredAt: row.hired_at,
    terminatedAt: row.terminated_at?.toISOString() ?? null,
    hasPin: !!row.pin_hash,
    pin: null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
  if (opts.includePin && row.pin_encrypted) {
    try {
      base.pin = decryptSecret(row.pin_encrypted);
    } catch {
      base.pin = null;
    }
  }
  return base;
}

export interface ListEmployeesOptions {
  status?: 'active' | 'terminated' | 'all';
  search?: string;
  /** When true, decrypt and include each employee's PIN in the response.
   *  The HTTP layer must enforce caller authorization (company_admin or
   *  supervisor, or global super_admin) before setting this. */
  includePin?: boolean;
}

export async function listEmployees(
  companyId: number,
  opts: ListEmployeesOptions = {},
): Promise<Employee[]> {
  const q = db<EmployeeRow>('employees').where({ company_id: companyId });
  if (opts.status && opts.status !== 'all') q.where('status', opts.status);
  if (opts.search) {
    const needle = `%${opts.search.replace(/[%_]/g, '\\$&')}%`;
    q.where((w) =>
      w
        .whereILike('first_name', needle)
        .orWhereILike('last_name', needle)
        .orWhereILike('employee_number', needle)
        .orWhereILike('email', needle),
    );
  }
  const rows = await q.orderBy(['last_name', 'first_name']);
  return rows.map((r) => rowToEmployee(r, { includePin: opts.includePin }));
}

export async function getEmployee(
  companyId: number,
  employeeId: number,
  opts: { includePin?: boolean } = {},
): Promise<Employee> {
  const row = await db<EmployeeRow>('employees')
    .where({ company_id: companyId, id: employeeId })
    .first();
  if (!row) throw NotFound('Employee not found');
  return rowToEmployee(row, opts);
}

async function ensureEmployeeNumberUnique(
  trx: Knex.Transaction,
  companyId: number,
  employeeNumber: string,
  excludeId?: number,
): Promise<void> {
  const q = trx('employees').where({ company_id: companyId, employee_number: employeeNumber });
  if (excludeId) q.whereNot('id', excludeId);
  const clash = await q.first<{ id: number }>();
  if (clash) throw Conflict(`Employee number "${employeeNumber}" is already in use`);
}

/**
 * Resolve the `users.id` of the (non-disabled) user whose email matches
 * the given string, case-insensitively. Used to auto-link a newly
 * created or edited `employees` row to an existing user account so
 * personal-device punch + timesheet access just works the moment an
 * admin types in the email of someone who was previously invited as a
 * team member (or vice versa).
 *
 * Without this link, `resolveEmployeeForUser` can't find the employee
 * row by `user_id` and every /punch/* call returns 403.
 */
async function findUserIdByEmail(
  trx: Knex.Transaction,
  email: string | null | undefined,
): Promise<number | null> {
  if (!email) return null;
  const row = await trx('users')
    .whereRaw('LOWER(email) = LOWER(?)', [email])
    .whereNull('disabled_at')
    .first<{ id: number }>();
  return row?.id ?? null;
}

export async function createEmployee(
  companyId: number,
  body: CreateEmployeeRequest,
): Promise<EmployeeWithPinResponse> {
  return db.transaction(async (trx) => {
    if (body.employeeNumber) {
      await ensureEmployeeNumberUnique(trx, companyId, body.employeeNumber);
    }

    const linkedUserId = await findUserIdByEmail(trx, body.email);

    const insertRow: Partial<EmployeeRow> = {
      company_id: companyId,
      first_name: body.firstName,
      last_name: body.lastName,
      employee_number: body.employeeNumber ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      hired_at: body.hiredAt ?? null,
      status: 'active',
      // Auto-link when email matches an existing user. The row stays
      // kiosk-only (user_id null) if there's no match — that's the
      // intended path for shared-device-only employees.
      user_id: linkedUserId,
    };

    let plaintextPin: string | undefined;
    if (body.generatePin) {
      const pin = await generatePinMaterial({
        companyId,
        trx,
        length: body.pinLength,
      });
      insertRow.pin_hash = pin.hash;
      insertRow.pin_fingerprint = pin.fingerprint;
      insertRow.pin_encrypted = encryptSecret(pin.pin);
      plaintextPin = pin.pin;
    }

    const [row] = await trx<EmployeeRow>('employees').insert(insertRow).returning('*');
    if (!row) throw new Error('failed to create employee');

    return {
      employee: rowToEmployee(row),
      ...(plaintextPin ? { plaintextPin } : {}),
    };
  });
}

export async function updateEmployee(
  companyId: number,
  employeeId: number,
  patch: UpdateEmployeeRequest,
): Promise<Employee> {
  return db.transaction(async (trx) => {
    const existing = await trx<EmployeeRow>('employees')
      .where({ company_id: companyId, id: employeeId })
      .first();
    if (!existing) throw NotFound('Employee not found');

    if (patch.employeeNumber && patch.employeeNumber !== existing.employee_number) {
      await ensureEmployeeNumberUnique(trx, companyId, patch.employeeNumber, employeeId);
    }

    const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.firstName !== undefined) updates.first_name = patch.firstName;
    if (patch.lastName !== undefined) updates.last_name = patch.lastName;
    if (patch.employeeNumber !== undefined) updates.employee_number = patch.employeeNumber;
    if (patch.email !== undefined) {
      updates.email = patch.email;
      // Re-resolve the user_id link whenever the email changes: clear
      // when the email is cleared, re-attach to the user whose email
      // now matches, or null out when no user has that email. Without
      // this, an employee whose email is corrected by the admin would
      // stay linked to the old user (or stay unlinked despite a
      // matching user existing).
      updates.user_id = patch.email === null ? null : await findUserIdByEmail(trx, patch.email);
    }
    if (patch.phone !== undefined) {
      // Canonicalize on write so all downstream SMS paths can assume
      // E.164. Raw 10-digit strings get dropped by TextLinkSMS's
      // paired Android without the country prefix.
      const normalized = patch.phone === null ? null : normalizeToE164(patch.phone);
      updates.phone = normalized;
      // Changing the phone number invalidates any prior verification —
      // otherwise an admin edit bypasses the SMS opt-in's ownership
      // proof. Unchanged values (same string) keep the verification.
      if ((normalized ?? null) !== (existing.phone ?? null)) {
        updates.phone_verified_at = null;
      }
    }
    if (patch.hiredAt !== undefined) updates.hired_at = patch.hiredAt;
    if (patch.status !== undefined) {
      updates.status = patch.status;
      updates.terminated_at =
        patch.status === 'terminated' && !existing.terminated_at
          ? trx.fn.now()
          : patch.status === 'active'
            ? null
            : existing.terminated_at;
      // When terminating, clear PIN material so the partial unique index
      // frees the fingerprint for reuse by future active employees.
      if (patch.status === 'terminated') {
        updates.pin_hash = null;
        updates.pin_fingerprint = null;
        updates.pin_encrypted = null;
      }
    }

    await trx('employees').where({ id: employeeId }).update(updates);

    const fresh = await trx<EmployeeRow>('employees').where({ id: employeeId }).first();
    if (!fresh) throw new Error('employee vanished');
    return rowToEmployee(fresh);
  });
}

export async function regeneratePin(
  companyId: number,
  employeeId: number,
  length = 6,
): Promise<EmployeeWithPinResponse> {
  return db.transaction(async (trx) => {
    const existing = await trx<EmployeeRow>('employees')
      .where({ company_id: companyId, id: employeeId, status: 'active' })
      .first();
    if (!existing) throw NotFound('Active employee not found');

    const pin = await generatePinMaterial({ companyId, trx, length });
    await trx('employees')
      .where({ id: employeeId })
      .update({
        pin_hash: pin.hash,
        pin_fingerprint: pin.fingerprint,
        pin_encrypted: encryptSecret(pin.pin),
        updated_at: trx.fn.now(),
      });

    const fresh = await trx<EmployeeRow>('employees').where({ id: employeeId }).first();
    if (!fresh) throw new Error('employee vanished');
    return { employee: rowToEmployee(fresh), plaintextPin: pin.pin };
  });
}

/**
 * Admin sets a PIN manually. Validates:
 *   - Shape: 4–6 digits, not a weak pattern (same rules as auto-gen).
 *   - Uniqueness: fingerprint doesn't collide with another active
 *     employee in the same company (partial unique index is the
 *     ultimate backstop; we pre-check for a clean error).
 *
 * Stores all three columns (hash, fingerprint, encrypted) in the same
 * transaction so an interrupted write never leaves the row half-updated.
 */
export async function setEmployeePinManually(
  companyId: number,
  employeeId: number,
  pin: string,
): Promise<EmployeeWithPinResponse> {
  if (!validatePinShape(pin)) {
    throw BadRequest('PIN must be 4–6 digits and must not be a weak pattern (e.g. 1234, 1111).');
  }

  return db.transaction(async (trx) => {
    const existing = await trx<EmployeeRow>('employees')
      .where({ company_id: companyId, id: employeeId, status: 'active' })
      .first();
    if (!existing) throw NotFound('Active employee not found');

    const fp = pinFingerprint(companyId, pin);
    const clash = await trx('employees')
      .where({ company_id: companyId, pin_fingerprint: fp, status: 'active' })
      .whereNot({ id: employeeId })
      .first<{ id: number }>();
    if (clash) {
      throw Conflict('Another active employee already has that PIN.');
    }

    const hash = await hashPin(pin);
    await trx('employees')
      .where({ id: employeeId })
      .update({
        pin_hash: hash,
        pin_fingerprint: fp,
        pin_encrypted: encryptSecret(pin),
        updated_at: trx.fn.now(),
      });

    const fresh = await trx<EmployeeRow>('employees').where({ id: employeeId }).first();
    if (!fresh) throw new Error('employee vanished');
    return { employee: rowToEmployee(fresh, { includePin: true }), plaintextPin: pin };
  });
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

const HEADER_ALIASES: Record<string, string> = {
  employee_number: 'employee_number',
  employeenumber: 'employee_number',
  number: 'employee_number',
  first_name: 'first_name',
  firstname: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  email: 'email',
  phone: 'phone',
};

function parseCsv(text: string): Array<Record<string, string>> {
  // Minimal RFC 4180 parser covering quoted fields with escaped quotes and
  // \n / \r\n line endings. Good enough for payroll roster imports.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (!headerRow) return [];

  const headers = headerRow.map((h) => {
    const normalized = h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    return HEADER_ALIASES[normalized] ?? normalized;
  });

  return dataRows.map((r) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i] as string] = (r[i] ?? '').trim();
    }
    return obj;
  });
}

export async function importEmployeesCsv(
  companyId: number,
  body: { csv: string; generatePins: boolean; pinLength: number },
): Promise<CsvImportResponse> {
  const rows = parseCsv(body.csv);
  const out: CsvImportResponse = {
    created: 0,
    skipped: 0,
    errors: [],
    employees: [],
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as Record<string, string>;
    const lineNo = i + 2; // +1 for header, +1 for 1-based display

    if (!row.first_name || !row.last_name) {
      out.errors.push({ row: lineNo, message: 'first_name and last_name are required' });
      out.skipped += 1;
      continue;
    }

    try {
      const created = await createEmployee(companyId, {
        firstName: row.first_name,
        lastName: row.last_name,
        ...(row.employee_number ? { employeeNumber: row.employee_number } : {}),
        ...(row.email ? { email: row.email } : {}),
        ...(row.phone ? { phone: row.phone } : {}),
        generatePin: body.generatePins,
        pinLength: body.pinLength,
      });
      out.created += 1;
      out.employees.push(created);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'failed to create employee';
      out.errors.push({ row: lineNo, message: msg });
      out.skipped += 1;
    }
  }

  if (out.created === 0 && rows.length === 0) {
    throw BadRequest('CSV contained no data rows');
  }

  return out;
}
