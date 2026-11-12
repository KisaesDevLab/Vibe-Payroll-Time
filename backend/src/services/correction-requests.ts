// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type {
  CorrectionRequest,
  CreateCorrectionRequest,
  DecideCorrectionRequest,
} from '@vibept/shared';
import {
  createCorrectionRequestSchema,
  proposedAddChangesSchema,
  proposedEditChangesSchema,
} from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';
import { assertAddedShiftWindow } from './manual-entries.js';
import {
  createEntryForEmployee,
  deleteEntry,
  editEntry,
  type EditEntryPatch,
  type TimeEntryRow,
} from './punch.js';
import { isTimeOffJob } from './time-off.js';

interface CorrectionRow {
  id: number;
  company_id: number;
  employee_id: number;
  time_entry_id: number | null;
  requester_user_id: number | null;
  request_type: 'edit' | 'add' | 'delete';
  proposed_changes: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: number | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToRequest(r: CorrectionRow): CorrectionRequest {
  return {
    id: r.id,
    companyId: r.company_id,
    employeeId: r.employee_id,
    timeEntryId: r.time_entry_id,
    requesterUserId: r.requester_user_id,
    requestType: r.request_type,
    proposedChanges: r.proposed_changes,
    reason: r.reason,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at?.toISOString() ?? null,
    reviewNote: r.review_note,
    createdAt: r.created_at.toISOString(),
  };
}

export async function listCorrectionRequests(
  companyId: number,
  opts: { status?: 'pending' | 'approved' | 'rejected'; employeeId?: number } = {},
): Promise<CorrectionRequest[]> {
  const q = db('correction_requests as cr')
    .join('employees as e', function () {
      this.on('e.id', '=', 'cr.employee_id').andOn('e.company_id', '=', 'cr.company_id');
    })
    .where('cr.company_id', companyId);
  if (opts.status) q.where('cr.status', opts.status);
  if (opts.employeeId) q.where('cr.employee_id', opts.employeeId);
  const rows = await q
    .orderBy('cr.created_at', 'desc')
    .orderBy('cr.id', 'desc')
    .select<
      Array<CorrectionRow & { first_name: string; last_name: string }>
    >('cr.*', 'e.first_name', 'e.last_name');
  return rows.map((r) => ({
    ...rowToRequest(r),
    employeeName: `${r.first_name} ${r.last_name}`.trim(),
  }));
}

/** The employee's own correction requests at this company, newest first. */
export async function listMyCorrectionRequests(
  companyId: number,
  employeeId: number,
): Promise<CorrectionRequest[]> {
  return listCorrectionRequests(companyId, { employeeId });
}

// ---------------------------------------------------------------------------
// Validation shared by create and approve
// ---------------------------------------------------------------------------

/**
 * The entry an edit/delete request targets, checked to still be one a
 * correction can change: the employee's own, not deleted, not approved
 * (approved time is corrected by a supervisor directly), not superseded
 * by a manual entry, and not time off (that's changed on the grid). Row
 * locked so the check holds until the caller's transaction ends.
 */
async function loadCorrectableEntry(
  trx: Knex.Transaction,
  companyId: number,
  employeeId: number,
  timeEntryId: number,
  when: 'create' | 'approve',
): Promise<TimeEntryRow> {
  const entry = await trx<TimeEntryRow>('time_entries')
    .where({ id: timeEntryId, company_id: companyId, employee_id: employeeId })
    .forUpdate()
    .first();
  const since = when === 'approve' ? ' since this request was made' : '';
  if (!entry) throw NotFound('Target entry not found');
  if (entry.deleted_at) {
    if (when === 'create') throw NotFound('Target entry not found');
    throw Conflict(`The entry was deleted${since}`);
  }
  if (entry.approved_at) {
    throw Conflict(`The entry has been approved${since}; ask a supervisor to correct it`);
  }
  if (entry.superseded_by_entry_id != null) {
    throw Conflict(`The entry has been replaced by a manual entry${since}`);
  }
  if (await isTimeOffJob(trx, companyId, entry.job_id)) {
    throw BadRequest('Time off is changed as hours on the weekly grid, not by a request');
  }
  return entry;
}

/** A proposed job must be an active job at this company and not a
 *  time-off code (time off is entered as hours on the grid). */
async function assertProposedJob(
  trx: Knex.Transaction,
  companyId: number,
  jobId: number | null | undefined,
): Promise<void> {
  if (jobId == null) return;
  const job = await trx('jobs')
    .where({ id: jobId, company_id: companyId })
    .whereNull('archived_at')
    .first<{ id: number }>('id');
  if (!job) throw NotFound('Active job not found for this company');
  if (await isTimeOffJob(trx, companyId, jobId)) {
    throw BadRequest('Time off is entered as hours on the weekly grid');
  }
}

/** Sanity of the span an edit would leave the entry with. editEntry
 *  re-checks this (plus overlap) when the request is applied. */
function assertEditedSpan(entry: TimeEntryRow, p: EditEntryPatch): void {
  if (p.startedAt === undefined && p.endedAt === undefined) return;
  const start = p.startedAt !== undefined ? new Date(p.startedAt) : entry.started_at;
  const end =
    p.endedAt !== undefined ? (p.endedAt === null ? null : new Date(p.endedAt)) : entry.ended_at;
  if (end && end <= start) throw BadRequest('Clock-out must be after clock-in');
  const latest = Date.now() + 60_000;
  if (start.getTime() > latest || (end && end.getTime() > latest)) {
    throw BadRequest("A correction can't move time into the future");
  }
}

/** Parse stored proposed changes against today's contract. A request
 *  stored before the strict schemas (or tampered with) is refused rather
 *  than half-applied. */
function parseProposed<T>(
  schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw Conflict('The proposed change is no longer valid; reject it and ask for a new request');
  }
  return r.data;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCorrectionRequest(
  companyId: number,
  employeeId: number,
  requesterUserId: number | null,
  input: CreateCorrectionRequest,
): Promise<CorrectionRequest> {
  // Callers other than the HTTP route (own-entries) reach here too, so
  // the per-type contract is enforced at the service as well.
  const body = createCorrectionRequestSchema.parse(input);

  return db.transaction(async (trx) => {
    if (body.requestType === 'add') {
      const p = proposedAddChangesSchema.parse(body.proposedChanges);
      // The same limits as adding the shift directly.
      assertAddedShiftWindow(new Date(p.startedAt), new Date(p.endedAt));
      await assertProposedJob(trx, companyId, p.jobId);
    } else {
      // Schema guarantees timeEntryId for edit/delete.
      const timeEntryId = body.timeEntryId!;
      // The row lock on the entry also serializes concurrent requests
      // against it, so the duplicate check below can't race.
      const entry = await loadCorrectableEntry(trx, companyId, employeeId, timeEntryId, 'create');
      if (body.requestType === 'edit') {
        const p = proposedEditChangesSchema.parse(body.proposedChanges) as EditEntryPatch;
        if (p.jobId !== undefined) await assertProposedJob(trx, companyId, p.jobId);
        assertEditedSpan(entry, p);
      }
      const pending = await trx('correction_requests')
        .where({ company_id: companyId, time_entry_id: timeEntryId, status: 'pending' })
        .first<{ id: number }>('id');
      if (pending) {
        throw Conflict(
          'There is already a pending request for this entry. Wait for a supervisor to decide it.',
        );
      }
    }

    const [row] = await trx<CorrectionRow>('correction_requests')
      .insert({
        company_id: companyId,
        employee_id: employeeId,
        time_entry_id: body.timeEntryId ?? null,
        requester_user_id: requesterUserId,
        request_type: body.requestType,
        proposed_changes: JSON.stringify(body.proposedChanges) as unknown as Record<
          string,
          unknown
        >,
        reason: body.reason,
      })
      .returning('*');
    if (!row) throw new Error('failed to create correction request');
    return rowToRequest(row);
  });
}

// ---------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------

/** Lock the request row and make sure it is still waiting for a decision. */
async function lockPendingRequest(
  trx: Knex.Transaction,
  companyId: number,
  requestId: number,
): Promise<CorrectionRow> {
  const existing = await trx<CorrectionRow>('correction_requests')
    .where({ id: requestId, company_id: companyId })
    .forUpdate()
    .first();
  if (!existing) throw NotFound('Correction request not found');
  if (existing.status !== 'pending') throw Conflict('Already decided');
  return existing;
}

/**
 * Approve a correction request: re-checks the target and the proposed
 * values, applies the change through the punch service chokepoint (so it
 * lands in the audit trail with a proper edit/delete/create action), and
 * marks the request approved — all in one transaction. The request row is
 * locked first, so two reviewers deciding at once can't both apply it.
 */
export async function approveCorrectionRequest(
  companyId: number,
  requestId: number,
  actor: { userId: number },
  body: DecideCorrectionRequest,
): Promise<CorrectionRequest> {
  return db.transaction(async (trx) => {
    const existing = await lockPendingRequest(trx, companyId, requestId);
    const reason = `correction:${existing.id} — ${existing.reason}`;
    const punchActor = { userId: actor.userId, companyId };

    if (existing.request_type === 'edit' || existing.request_type === 'delete') {
      if (!existing.time_entry_id) {
        throw Conflict(`${existing.request_type} request has no target entry`);
      }
      // Per-employee punch lock before the entry's row lock — the order
      // the punch service takes them in — so applying a correction can't
      // deadlock with a punch closing the same entry.
      await trx.raw('SELECT pg_advisory_xact_lock(?)', [existing.employee_id]);
      const entry = await loadCorrectableEntry(
        trx,
        companyId,
        existing.employee_id,
        existing.time_entry_id,
        'approve',
      );
      if (existing.request_type === 'edit') {
        const p = parseProposed<EditEntryPatch>(
          proposedEditChangesSchema,
          existing.proposed_changes,
        );
        if (p.jobId !== undefined) await assertProposedJob(trx, companyId, p.jobId);
        assertEditedSpan(entry, p);
        await editEntry(existing.time_entry_id, p, punchActor, reason, trx);
      } else {
        await deleteEntry(existing.time_entry_id, punchActor, reason, trx);
      }
    } else {
      // An `add` request carrying a complete shift ("Add time" on My
      // timesheet) creates it, attributed to the reviewer, with the
      // overlap check and audit row of any admin-created entry. Older
      // free-form add requests (no times) stay a prompt to hand-create
      // the entry.
      const raw = existing.proposed_changes as { startedAt?: unknown; endedAt?: unknown };
      if (raw.startedAt !== undefined || raw.endedAt !== undefined) {
        const p = parseProposed(proposedAddChangesSchema, existing.proposed_changes);
        const startedAt = new Date(p.startedAt);
        const endedAt = new Date(p.endedAt);
        assertAddedShiftWindow(startedAt, endedAt);
        await assertProposedJob(trx, companyId, p.jobId);
        await createEntryForEmployee(
          {
            employeeId: existing.employee_id,
            startedAt: p.startedAt,
            endedAt: p.endedAt,
            entryType: p.entryType ?? 'work',
            jobId: p.jobId ?? null,
            reason,
          },
          punchActor,
          trx,
        );
      }
    }

    const [row] = await trx<CorrectionRow>('correction_requests')
      .where({ id: requestId })
      .update({
        status: 'approved',
        reviewed_by: actor.userId,
        reviewed_at: trx.fn.now(),
        review_note: body.reviewNote ?? null,
        updated_at: trx.fn.now(),
      })
      .returning('*');
    if (!row) throw new Error('correction request vanished after approval');
    return rowToRequest(row);
  });
}

export async function rejectCorrectionRequest(
  companyId: number,
  requestId: number,
  actor: { userId: number },
  body: DecideCorrectionRequest,
): Promise<CorrectionRequest> {
  return db.transaction(async (trx) => {
    await lockPendingRequest(trx, companyId, requestId);
    const [row] = await trx<CorrectionRow>('correction_requests')
      .where({ id: requestId })
      .update({
        status: 'rejected',
        reviewed_by: actor.userId,
        reviewed_at: trx.fn.now(),
        review_note: body.reviewNote ?? null,
        updated_at: trx.fn.now(),
      })
      .returning('*');
    if (!row) throw new Error('correction request vanished after rejection');
    return rowToRequest(row);
  });
}
