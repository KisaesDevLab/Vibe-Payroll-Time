// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { DefaultTimeOffCategory, TimeOffJobInfo, TimeOffTypeState } from '@vibept/shared';
import { DEFAULT_TIME_OFF_TYPES } from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { BadRequest, Conflict } from '../http/errors.js';

/**
 * Time off is a job code with a flag (ADDENDUM_TIME_OFF.md). Entries on
 * a time-off code live in `time_entries` like any manual entry; the
 * summary builder splits them out of worked hours, so FLSA overtime is
 * always computed on hours actually worked.
 *
 * A company switches the four standard types (PTO, sick, holiday,
 * unpaid) on and off under Settings → Time off. Switching one on
 * creates its job code, or restores it if it was archived; switching it
 * off archives the code, so no new entries can use it while every
 * historical entry keeps its job. Firms add further codes (bereavement,
 * jury duty, …) on the Jobs page.
 */

interface TimeOffJobRow {
  id: number;
  code: string;
  time_off_category: string;
  is_paid: boolean;
  archived_at: Date | null;
}

/** Every time-off job of a company, archived ones included (history
 *  must still sum as time off after a type is switched off). */
export async function loadTimeOffJobs(
  companyId: number,
  conn: Knex | Knex.Transaction = db,
): Promise<Map<number, TimeOffJobInfo>> {
  const rows = await conn('jobs')
    .where({ company_id: companyId, is_time_off: true })
    .select<TimeOffJobRow[]>('id', 'time_off_category', 'is_paid');
  return new Map(
    rows.map((r) => [
      r.id,
      { category: r.time_off_category as TimeOffJobInfo['category'], isPaid: r.is_paid },
    ]),
  );
}

export async function isTimeOffJob(
  conn: Knex | Knex.Transaction,
  companyId: number,
  jobId: number | null,
): Promise<boolean> {
  if (jobId == null) return false;
  const row = await conn('jobs')
    .where({ id: jobId, company_id: companyId })
    .first<{ is_time_off: boolean }>('is_time_off');
  return !!row?.is_time_off;
}

/** The standard type's job: the oldest time-off code in its category. */
async function findTypeJob(
  conn: Knex | Knex.Transaction,
  companyId: number,
  category: DefaultTimeOffCategory,
): Promise<TimeOffJobRow | undefined> {
  return conn('jobs')
    .where({ company_id: companyId, is_time_off: true, time_off_category: category })
    .orderByRaw('archived_at IS NOT NULL, id')
    .first<TimeOffJobRow>('id', 'code', 'time_off_category', 'is_paid', 'archived_at');
}

export async function listTimeOffTypes(companyId: number): Promise<TimeOffTypeState[]> {
  const out: TimeOffTypeState[] = [];
  for (const t of DEFAULT_TIME_OFF_TYPES) {
    const job = await findTypeJob(db, companyId, t.category);
    out.push({
      category: t.category,
      code: job?.code ?? t.code,
      name: t.name,
      isPaid: job?.is_paid ?? t.isPaid,
      enabled: !!job && job.archived_at === null,
      jobId: job?.id ?? null,
    });
  }
  return out;
}

export async function setTimeOffType(
  companyId: number,
  category: string,
  enabled: boolean,
): Promise<TimeOffTypeState[]> {
  const type = DEFAULT_TIME_OFF_TYPES.find((t) => t.category === category);
  if (!type) throw BadRequest(`Unknown time-off type: ${category}`);

  await db.transaction(async (trx) => {
    const job = await findTypeJob(trx, companyId, type.category);
    if (enabled) {
      if (job) {
        if (job.archived_at) {
          await trx('jobs').where({ id: job.id, company_id: companyId }).update({
            archived_at: null,
            is_active: true,
            updated_at: trx.fn.now(),
          });
        }
        return;
      }
      const clash = await trx('jobs')
        .where({ company_id: companyId, code: type.code })
        .first<{ id: number }>('id');
      if (clash) {
        throw Conflict(
          `A job with code "${type.code}" already exists. Rename it, or edit it on the Jobs page and mark it as a time-off code.`,
        );
      }
      await trx('jobs').insert({
        company_id: companyId,
        code: type.code,
        name: type.name,
        is_time_off: true,
        time_off_category: type.category,
        is_paid: type.isPaid,
      });
    } else if (job && !job.archived_at) {
      await trx('jobs').where({ id: job.id, company_id: companyId }).update({
        archived_at: trx.fn.now(),
        is_active: false,
        updated_at: trx.fn.now(),
      });
    }
  });
  return listTimeOffTypes(companyId);
}
