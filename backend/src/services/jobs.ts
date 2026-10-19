// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { CreateJobRequest, Job, TimeOffCategory, UpdateJobRequest } from '@vibept/shared';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';

interface JobRow {
  id: number;
  company_id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  is_time_off: boolean;
  time_off_category: TimeOffCategory | null;
  is_paid: boolean;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

function rowToJob(row: JobRow): Job {
  return {
    id: row.id,
    companyId: row.company_id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    isTimeOff: row.is_time_off,
    timeOffCategory: row.time_off_category,
    isPaid: row.is_paid,
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
  };
}

/**
 * Normalize the time-off fields of a create/update. A time-off code needs
 * a category; an ordinary job has none and is always "paid" (unpaid only
 * means something for leave).
 */
function timeOffColumns(next: {
  isTimeOff: boolean;
  timeOffCategory: TimeOffCategory | null;
  isPaid: boolean;
}): { is_time_off: boolean; time_off_category: TimeOffCategory | null; is_paid: boolean } {
  if (!next.isTimeOff) return { is_time_off: false, time_off_category: null, is_paid: true };
  if (!next.timeOffCategory) throw BadRequest('Pick a category for a time-off code');
  return {
    is_time_off: true,
    time_off_category: next.timeOffCategory,
    // Unpaid leave is unpaid by definition.
    is_paid: next.timeOffCategory === 'unpaid' ? false : next.isPaid,
  };
}

export async function listJobs(
  companyId: number,
  opts: { includeArchived?: boolean } = {},
): Promise<Job[]> {
  const q = db<JobRow>('jobs').where({ company_id: companyId });
  if (!opts.includeArchived) q.whereNull('archived_at');
  const rows = await q.orderBy(['code']);
  return rows.map(rowToJob);
}

export async function createJob(companyId: number, body: CreateJobRequest): Promise<Job> {
  return db.transaction(async (trx) => {
    const clash = await trx<JobRow>('jobs')
      .where({ company_id: companyId, code: body.code })
      .first();
    if (clash) throw Conflict(`Job code "${body.code}" is already in use`);

    const [row] = await trx<JobRow>('jobs')
      .insert({
        company_id: companyId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        ...timeOffColumns({
          isTimeOff: body.isTimeOff ?? false,
          timeOffCategory: body.timeOffCategory ?? null,
          isPaid: body.isPaid ?? true,
        }),
      })
      .returning('*');
    if (!row) throw new Error('failed to create job');
    return rowToJob(row);
  });
}

export async function updateJob(
  companyId: number,
  jobId: number,
  patch: UpdateJobRequest,
): Promise<Job> {
  return db.transaction(async (trx) => {
    const existing = await trx<JobRow>('jobs').where({ company_id: companyId, id: jobId }).first();
    if (!existing) throw NotFound('Job not found');

    if (patch.code && patch.code !== existing.code) {
      const clash = await trx<JobRow>('jobs')
        .where({ company_id: companyId, code: patch.code })
        .whereNot('id', jobId)
        .first();
      if (clash) throw Conflict(`Job code "${patch.code}" is already in use`);
    }

    const updates: Record<string, unknown> = { updated_at: trx.fn.now() };
    if (patch.code !== undefined) updates.code = patch.code;
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.isActive !== undefined) updates.is_active = patch.isActive;
    if (
      patch.isTimeOff !== undefined ||
      patch.timeOffCategory !== undefined ||
      patch.isPaid !== undefined
    ) {
      const isTimeOff = patch.isTimeOff ?? existing.is_time_off;
      if (isTimeOff !== existing.is_time_off) {
        // Totals are derived on every read, so flipping a code between
        // work and time off would silently restate approved timesheets
        // and payroll exports.
        const approved = await trx('time_entries')
          .where({ company_id: companyId, job_id: jobId })
          .whereNotNull('approved_at')
          .whereNull('deleted_at')
          .first<{ id: number }>('id');
        if (approved) {
          throw Conflict(
            'This code has approved entries, so it cannot switch between work and time off. Create a new code instead.',
          );
        }
      }
      Object.assign(
        updates,
        timeOffColumns({
          isTimeOff,
          timeOffCategory:
            patch.timeOffCategory !== undefined
              ? patch.timeOffCategory
              : existing.time_off_category,
          isPaid: patch.isPaid ?? existing.is_paid,
        }),
      );
    }

    // Repeat the company_id guard on the UPDATE itself — jobs.id is unique
    // so an attacker passing a foreign jobId would already 404 above, but
    // re-asserting tenant scope on every write keeps the pattern safe
    // against future refactors that drop the existence check.
    await trx('jobs').where({ id: jobId, company_id: companyId }).update(updates);

    const fresh = await trx<JobRow>('jobs').where({ id: jobId, company_id: companyId }).first();
    if (!fresh) throw new Error('job vanished');
    return rowToJob(fresh);
  });
}

export async function archiveJob(companyId: number, jobId: number): Promise<void> {
  const existing = await db<JobRow>('jobs').where({ company_id: companyId, id: jobId }).first();
  if (!existing) throw NotFound('Job not found');
  if (existing.archived_at) return;
  await db('jobs').where({ id: jobId, company_id: companyId }).update({
    archived_at: db.fn.now(),
    is_active: false,
    updated_at: db.fn.now(),
  });
}

export async function unarchiveJob(companyId: number, jobId: number): Promise<Job> {
  const existing = await db<JobRow>('jobs').where({ company_id: companyId, id: jobId }).first();
  if (!existing) throw NotFound('Job not found');
  await db('jobs').where({ id: jobId, company_id: companyId }).update({
    archived_at: null,
    is_active: true,
    updated_at: db.fn.now(),
  });
  const fresh = await db<JobRow>('jobs').where({ id: jobId, company_id: companyId }).first();
  if (!fresh) throw new Error('job vanished');
  return rowToJob(fresh);
}
