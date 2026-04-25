// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { CreateJobRequest, Job, UpdateJobRequest } from '@vibept/shared';
import { db } from '../db/knex.js';
import { Conflict, NotFound } from '../http/errors.js';

interface JobRow {
  id: number;
  company_id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
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
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
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
