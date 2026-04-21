// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type {
  CorrectionRequest,
  CreateCorrectionRequest,
  DecideCorrectionRequest,
} from '@vibept/shared';
import { db } from '../db/knex.js';
import { Conflict, NotFound } from '../http/errors.js';
import { deleteEntry, editEntry, type EditEntryPatch } from './punch.js';

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
  const q = db<CorrectionRow>('correction_requests').where({ company_id: companyId });
  if (opts.status) q.where('status', opts.status);
  if (opts.employeeId) q.where('employee_id', opts.employeeId);
  const rows = await q.orderBy('created_at', 'desc');
  return rows.map(rowToRequest);
}

export async function createCorrectionRequest(
  companyId: number,
  employeeId: number,
  requesterUserId: number | null,
  body: CreateCorrectionRequest,
): Promise<CorrectionRequest> {
  // `edit` and `delete` must reference an existing entry owned by the
  // employee in this company; `add` does not.
  if (body.requestType !== 'add') {
    if (!body.timeEntryId) throw NotFound('timeEntryId required for edit/delete requests');
    const entry = await db('time_entries')
      .where({ id: body.timeEntryId, company_id: companyId, employee_id: employeeId })
      .whereNull('deleted_at')
      .first<{ id: number }>();
    if (!entry) throw NotFound('Target entry not found');
  }

  const [row] = await db<CorrectionRow>('correction_requests')
    .insert({
      company_id: companyId,
      employee_id: employeeId,
      time_entry_id: body.timeEntryId ?? null,
      requester_user_id: requesterUserId,
      request_type: body.requestType,
      proposed_changes: JSON.stringify(body.proposedChanges) as unknown as Record<string, unknown>,
      reason: body.reason,
    })
    .returning('*');
  if (!row) throw new Error('failed to create correction request');
  return rowToRequest(row);
}

/**
 * Approve a correction request: applies the proposed change through the
 * punch service chokepoint (so it lands in the audit trail with a proper
 * edit/delete action), then marks the request approved. All-or-nothing
 * in a single transaction against the primary `correction_requests`
 * row — the punch service opens its own transaction, so concurrent
 * mutations on the target entry remain serialized via advisory lock.
 */
export async function approveCorrectionRequest(
  companyId: number,
  requestId: number,
  actor: { userId: number },
  body: DecideCorrectionRequest,
): Promise<CorrectionRequest> {
  const existing = await db<CorrectionRow>('correction_requests')
    .where({ id: requestId, company_id: companyId })
    .first();
  if (!existing) throw NotFound('Correction request not found');
  if (existing.status !== 'pending') throw Conflict('Already decided');

  const reason = `correction:${existing.id} — ${existing.reason}`;

  if (existing.request_type === 'edit') {
    if (!existing.time_entry_id) throw NotFound('Edit request missing target entry');
    await editEntry(
      existing.time_entry_id,
      existing.proposed_changes as EditEntryPatch,
      { userId: actor.userId, companyId },
      reason,
    );
  } else if (existing.request_type === 'delete') {
    if (!existing.time_entry_id) throw NotFound('Delete request missing target entry');
    await deleteEntry(existing.time_entry_id, { userId: actor.userId, companyId }, reason);
  }
  // `add` requests don't auto-create entries in Phase 6 — the reviewer
  // uses them as a prompt to hand-create the entry via the admin edit
  // surface. Phase 11's NL correction feature is the intended surface
  // for auto-applied adds.

  const [row] = await db<CorrectionRow>('correction_requests')
    .where({ id: requestId })
    .update({
      status: 'approved',
      reviewed_by: actor.userId,
      reviewed_at: db.fn.now(),
      review_note: body.reviewNote ?? null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (!row) throw new Error('correction request vanished after approval');
  return rowToRequest(row);
}

export async function rejectCorrectionRequest(
  companyId: number,
  requestId: number,
  actor: { userId: number },
  body: DecideCorrectionRequest,
): Promise<CorrectionRequest> {
  const existing = await db<CorrectionRow>('correction_requests')
    .where({ id: requestId, company_id: companyId })
    .first();
  if (!existing) throw NotFound('Correction request not found');
  if (existing.status !== 'pending') throw Conflict('Already decided');

  const [row] = await db<CorrectionRow>('correction_requests')
    .where({ id: requestId })
    .update({
      status: 'rejected',
      reviewed_by: actor.userId,
      reviewed_at: db.fn.now(),
      review_note: body.reviewNote ?? null,
      updated_at: db.fn.now(),
    })
    .returning('*');
  if (!row) throw new Error('correction request vanished after rejection');
  return rowToRequest(row);
}
