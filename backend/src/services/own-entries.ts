// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type {
  AddOwnEntryRequest,
  AddOwnEntryResponse,
  EmployeeManualEntryMode,
} from '@vibept/shared';
import { db } from '../db/knex.js';
import { BadRequest, Forbidden, NotFound } from '../http/errors.js';
import { createCorrectionRequest } from './correction-requests.js';
import { assertAddedShiftWindow, isPayPeriodApproved } from './manual-entries.js';
import { createEntryForEmployee } from './punch.js';
import { isTimeOffJob } from './time-off.js';

/**
 * An employee adds a shift they forgot to punch ("Add time" on My
 * timesheet). Follows the company's manual-entry policy:
 *
 *   allowed        saved straight away, audited as created by the
 *                  employee with their reason
 *   override_only  sent to a supervisor as an `add` correction request
 *   disabled       same: employees can't write time themselves, but
 *                  asking is always allowed
 *
 * A shift in a pay period that already has approved time always becomes
 * a request, since approved timesheets are locked to employees.
 */
export async function addOwnEntry(
  companyId: number,
  userId: number,
  body: AddOwnEntryRequest,
  ctx: { sourceIp?: string | null; sourceUserAgent?: string | null } = {},
): Promise<AddOwnEntryResponse> {
  const startedAt = new Date(body.startedAt);
  const endedAt = new Date(body.endedAt);
  assertAddedShiftWindow(startedAt, endedAt);

  const employee = await db('employees')
    .where({ company_id: companyId, user_id: userId, status: 'active' })
    .first<{ id: number; login_disabled_at: Date | null }>('id', 'login_disabled_at');
  if (!employee) throw Forbidden('Not an active employee at this company');
  if (employee.login_disabled_at)
    throw Forbidden('Your sign-in to this company has been turned off');

  const jobId = body.jobId ?? null;
  if (jobId != null) {
    const job = await db('jobs')
      .where({ id: jobId, company_id: companyId })
      .whereNull('archived_at')
      .first<{ id: number }>('id');
    if (!job) throw NotFound('Active job not found for this company');
    if (await isTimeOffJob(db, companyId, jobId)) {
      throw BadRequest('Time off is entered as hours on the weekly grid');
    }
  }

  const settings = await db('company_settings')
    .where({ company_id: companyId })
    .first<{ employee_manual_entry_mode: EmployeeManualEntryMode }>();
  if (!settings) throw NotFound('Company not found');

  // Approved time in the pay-period week(s) the shift touches locks it to
  // employees. The end is exclusive: a shift ending on the stroke of a
  // new period doesn't touch it.
  const approved = await isPayPeriodApproved(db, companyId, employee.id, [
    startedAt,
    new Date(endedAt.getTime() - 1),
  ]);

  if (settings.employee_manual_entry_mode === 'allowed' && !approved) {
    const entry = await createEntryForEmployee(
      {
        employeeId: employee.id,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        entryType: 'work',
        jobId,
        reason: body.reason,
      },
      // Stamped distinctly from a supervisor-created entry.
      { userId, companyId, ...ctx, sourceDeviceId: `web-self-${userId}` },
    );
    return { status: 'added', entry, request: null };
  }

  const request = await createCorrectionRequest(companyId, employee.id, userId, {
    requestType: 'add',
    proposedChanges: {
      entryType: 'work',
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      jobId,
    },
    reason: body.reason,
  });
  return { status: 'requested', entry: null, request };
}
