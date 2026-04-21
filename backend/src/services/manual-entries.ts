import type {
  CompanyRole,
  EmployeeManualEntryMode,
  GlobalRole,
  ManualEntryResponse,
  PunchSource,
} from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from './punch.js';

// ---------------------------------------------------------------------------
// Pure authorization function (unit-testable without touching the DB).
// ---------------------------------------------------------------------------

export interface ManualEditActor {
  roleGlobal: GlobalRole;
  companyRole: CompanyRole | null;
  /** Is the actor the employee whose entry this is? (Employees can only
   *  edit their own rows.) */
  isOwnEntry: boolean;
}

export interface ManualEditContext {
  /** Is the pay period containing this entry already approved? */
  isApproved: boolean;
  /** Company-level toggle. */
  mode: EmployeeManualEntryMode;
}

export interface ManualEditDecision {
  allowed: boolean;
  reason: string | null;
}

/**
 * The entire manual-entry authorization matrix lives here. Twelve
 * combinations of (role × mode × approval state). Unit-tested to 100%
 * branch coverage so the audit trail's authorization claims are
 * defensible to a wage-and-hour auditor.
 */
export function canManualEdit(actor: ManualEditActor, ctx: ManualEditContext): ManualEditDecision {
  if (actor.roleGlobal === 'super_admin') {
    return { allowed: true, reason: null };
  }
  switch (actor.companyRole) {
    case 'company_admin':
    case 'supervisor':
      // Supervisors and admins may edit approved or unapproved periods.
      // Mode setting doesn't restrict them — it's an employee-only
      // guardrail.
      return { allowed: true, reason: null };
    case 'employee': {
      if (!actor.isOwnEntry) {
        return { allowed: false, reason: 'Employees may only edit their own entries' };
      }
      if (ctx.mode === 'disabled') {
        return {
          allowed: false,
          reason: 'Manual entries are disabled for employees at this company',
        };
      }
      if (ctx.isApproved) {
        return { allowed: false, reason: 'The pay period is already approved' };
      }
      // `override_only` does not block edits at this layer — it only
      // blocks free-form creations (handled in create path).
      return { allowed: true, reason: null };
    }
    default:
      return { allowed: false, reason: 'No company membership' };
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface CompanyConfig {
  timezone: string;
  manualEntryMode: EmployeeManualEntryMode;
  requiresApproval: boolean;
}

async function loadCompanyConfig(
  trx: Knex | Knex.Transaction,
  companyId: number,
): Promise<CompanyConfig> {
  const company = await trx('companies').where({ id: companyId }).first<{ timezone: string }>();
  if (!company) throw NotFound('Company not found');
  const settings = await trx('company_settings').where({ company_id: companyId }).first<{
    employee_manual_entry_mode: EmployeeManualEntryMode;
    manual_entry_requires_approval: boolean;
  }>();
  if (!settings) throw NotFound('Company settings not found');
  return {
    timezone: company.timezone,
    manualEntryMode: settings.employee_manual_entry_mode,
    requiresApproval: settings.manual_entry_requires_approval,
  };
}

async function loadActorContext(
  trx: Knex | Knex.Transaction,
  actor: { userId: number; roleGlobal: GlobalRole },
  companyId: number,
  employeeId: number,
): Promise<ManualEditActor> {
  const membership = await trx('company_memberships')
    .where({ user_id: actor.userId, company_id: companyId })
    .first<{ role: CompanyRole }>();
  const employee = await trx('employees')
    .where({ id: employeeId, company_id: companyId })
    .first<{ user_id: number | null; status: string }>();
  if (!employee) throw NotFound('Employee not found');
  return {
    roleGlobal: actor.roleGlobal,
    companyRole: membership?.role ?? null,
    isOwnEntry: employee.user_id === actor.userId,
  };
}

async function ensureJobBelongsToCompany(
  trx: Knex | Knex.Transaction,
  companyId: number,
  jobId: number,
): Promise<void> {
  const row = await trx('jobs')
    .where({ id: jobId, company_id: companyId })
    .whereNull('archived_at')
    .first<{ id: number }>();
  if (!row) throw NotFound('Active job not found for this company');
}

/**
 * Resolve the `day` (YYYY-MM-DD) in company TZ to a UTC timestamp at
 * local-midnight. This timestamp is stored as `started_at` so the
 * partial-unique index can key off `(started_at::date)` consistently.
 */
async function localMidnightToUtc(
  trx: Knex | Knex.Transaction,
  tz: string,
  isoDay: string,
): Promise<Date> {
  // `(YYYY-MM-DD 00:00)::timestamp AT TIME ZONE <tz>` returns the UTC
  // instant of local-midnight-in-tz, naturally handling DST.
  const res = await trx.raw<{ rows: Array<{ ts: Date }> }>(
    `SELECT (?::timestamp AT TIME ZONE ?) AS ts`,
    [`${isoDay} 00:00:00`, tz],
  );
  const ts = res.rows[0]?.ts;
  if (!ts) throw BadRequest('Unable to resolve day in company timezone');
  return new Date(ts);
}

/**
 * Find non-deleted, non-superseded punch entries that fall on the same
 * (employee, company-local day, optional job). Used at create time to
 * mark them `superseded_by_entry_id`.
 */
async function findOverlappingPunches(
  trx: Knex | Knex.Transaction,
  companyId: number,
  employeeId: number,
  tz: string,
  isoDay: string,
  jobId: number | null,
): Promise<TimeEntryRow[]> {
  const q = trx<TimeEntryRow>('time_entries')
    .where({ company_id: companyId, employee_id: employeeId })
    .whereNot('source', 'web_manual')
    .whereNull('deleted_at')
    .whereNull('superseded_by_entry_id')
    .whereRaw(`date_trunc('day', started_at AT TIME ZONE ?) = ?::date`, [tz, isoDay])
    .forUpdate();
  if (jobId != null) {
    q.andWhere('job_id', jobId);
  }
  return q;
}

async function writeAudit(
  trx: Knex.Transaction,
  input: {
    timeEntryId: number;
    companyId: number;
    actorUserId: number | null;
    action:
      | 'manual_create'
      | 'manual_update'
      | 'manual_delete'
      | 'manual_override'
      | 'manual_revert';
    field?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
  },
): Promise<void> {
  await trx('time_entry_audit').insert({
    time_entry_id: input.timeEntryId,
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    action: input.action,
    field: input.field ?? null,
    old_value: input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
    new_value: input.newValue === undefined ? null : JSON.stringify(input.newValue),
    reason: input.reason ?? null,
  });
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateManualEntryInput {
  companyId: number;
  employeeId: number;
  day: string; // YYYY-MM-DD in company tz
  jobId: number | null;
  durationSeconds: number;
  reason: string;
  /** Echoed into audit so "typed 5:48 · stored 20880s" is retrievable. */
  typedInput?: string;
  actor: {
    userId: number;
    roleGlobal: GlobalRole;
    sourceIp?: string | null;
    sourceUserAgent?: string | null;
  };
}

export async function createManualEntry(
  input: CreateManualEntryInput,
): Promise<ManualEntryResponse> {
  if (input.durationSeconds <= 0) throw BadRequest('Duration must be greater than 0');
  if (input.durationSeconds > 86_400) throw BadRequest('Duration must be ≤ 24 hours');
  if (!input.reason.trim()) throw BadRequest('Reason is required for manual entries');

  return db.transaction(async (trx) => {
    const config = await loadCompanyConfig(trx, input.companyId);
    const actorCtx = await loadActorContext(
      trx,
      { userId: input.actor.userId, roleGlobal: input.actor.roleGlobal },
      input.companyId,
      input.employeeId,
    );

    // Approval state of any existing punch on this day (approved punches
    // gate employee-originated manual entries).
    const approvedEntryToday = await trx('time_entries')
      .where({ company_id: input.companyId, employee_id: input.employeeId })
      .whereNull('deleted_at')
      .whereRaw(`date_trunc('day', started_at AT TIME ZONE ?) = ?::date`, [
        config.timezone,
        input.day,
      ])
      .whereNotNull('approved_at')
      .first<{ id: number }>();

    const decision = canManualEdit(actorCtx, {
      isApproved: !!approvedEntryToday,
      mode: config.manualEntryMode,
    });
    if (!decision.allowed) {
      throw Forbidden(decision.reason ?? 'Not allowed');
    }

    // `override_only` means employees may create a manual entry only
    // when there's an existing punch on this day for this job to
    // override. Supervisors/admins are already past the canManualEdit
    // gate and skip this check.
    if (
      actorCtx.companyRole === 'employee' &&
      config.manualEntryMode === 'override_only' &&
      actorCtx.roleGlobal !== 'super_admin'
    ) {
      const punchExists = await findOverlappingPunches(
        trx,
        input.companyId,
        input.employeeId,
        config.timezone,
        input.day,
        input.jobId,
      );
      if (punchExists.length === 0) {
        throw Forbidden(
          'This company only permits employee manual entries that override an existing punch',
        );
      }
    }

    await ensureActiveEmployee(trx, input.companyId, input.employeeId);
    if (input.jobId != null) {
      await ensureJobBelongsToCompany(trx, input.companyId, input.jobId);
    }

    const startedAtUtc = await localMidnightToUtc(trx, config.timezone, input.day);
    const endedAtUtc = new Date(startedAtUtc.getTime() + input.durationSeconds * 1000);

    // Lock the day's rows for this employee so concurrent creates race
    // cleanly to the unique-index violation.
    const overlapping = await findOverlappingPunches(
      trx,
      input.companyId,
      input.employeeId,
      config.timezone,
      input.day,
      input.jobId,
    );
    const supersededIds = overlapping.map((r) => r.id);

    const insertRow: Record<string, unknown> = {
      company_id: input.companyId,
      employee_id: input.employeeId,
      shift_id: trx.raw('gen_random_uuid()'),
      entry_type: 'work',
      job_id: input.jobId,
      started_at: startedAtUtc,
      ended_at: endedAtUtc,
      duration_seconds: input.durationSeconds,
      source: 'web_manual' satisfies PunchSource,
      source_device_id: `web-manual-${input.actor.userId}`,
      source_offline: false,
      source_ip: input.actor.sourceIp ?? null,
      source_user_agent: input.actor.sourceUserAgent ?? null,
      entry_reason: input.reason,
      supersedes_entry_ids: supersededIds.length > 0 ? supersededIds : null,
      created_by: input.actor.userId,
      edited_by: input.actor.userId,
      edit_reason: input.reason,
    };

    let inserted: TimeEntryRow;
    try {
      const rows = await trx<TimeEntryRow>('time_entries')
        .insert(insertRow)
        .returning<TimeEntryRow[]>('*');
      inserted = rows[0]!;
    } catch (err) {
      // 23505 = unique_violation. Our partial unique on
      // (employee, day, job) WHERE source=web_manual AND not superseded
      // AND not deleted — a concurrent writer beat us to it.
      if ((err as { code?: string }).code === '23505') {
        throw Conflict(
          'Another manual entry already exists for this employee on that day/job. Refresh and edit it instead.',
        );
      }
      throw err;
    }

    // Mark the overlapping punches as superseded.
    if (supersededIds.length > 0) {
      await trx('time_entries')
        .whereIn('id', supersededIds)
        .update({ superseded_by_entry_id: inserted.id, updated_at: trx.fn.now() });
    }

    await writeAudit(trx, {
      timeEntryId: inserted.id,
      companyId: input.companyId,
      actorUserId: input.actor.userId,
      action: 'manual_create',
      reason: input.reason,
      newValue: {
        day: input.day,
        jobId: input.jobId,
        durationSeconds: input.durationSeconds,
        typedInput: input.typedInput ?? null,
      },
    });
    if (supersededIds.length > 0) {
      // One row per superseded entry + one rolled-up `manual_override`
      // row on the new manual entry for easy diff-in-the-UI.
      for (const id of supersededIds) {
        await writeAudit(trx, {
          timeEntryId: id,
          companyId: input.companyId,
          actorUserId: input.actor.userId,
          action: 'manual_override',
          field: 'superseded_by_entry_id',
          oldValue: null,
          newValue: inserted.id,
          reason: input.reason,
        });
      }
    }

    return {
      entry: rowToTimeEntry(inserted),
      supersededEntryIds: supersededIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export interface UpdateManualEntryInput {
  entryId: number;
  companyId: number;
  durationSeconds?: number;
  reason?: string;
  typedInput?: string;
  actor: { userId: number; roleGlobal: GlobalRole };
}

export async function updateManualEntry(
  input: UpdateManualEntryInput,
): Promise<ManualEntryResponse> {
  if (input.durationSeconds !== undefined) {
    if (input.durationSeconds > 86_400) throw BadRequest('Duration must be ≤ 24 hours');
    if (input.durationSeconds < 0) throw BadRequest('Duration must be ≥ 0');
  }

  return db.transaction(async (trx) => {
    const row = await trx<TimeEntryRow>('time_entries')
      .where({ id: input.entryId, company_id: input.companyId })
      .whereNull('deleted_at')
      .forUpdate()
      .first();
    if (!row) throw NotFound('Manual entry not found');
    if (row.source !== 'web_manual') throw BadRequest('Target is not a manual entry');

    const config = await loadCompanyConfig(trx, input.companyId);
    const actorCtx = await loadActorContext(
      trx,
      { userId: input.actor.userId, roleGlobal: input.actor.roleGlobal },
      input.companyId,
      row.employee_id,
    );
    const decision = canManualEdit(actorCtx, {
      isApproved: !!row.approved_at,
      mode: config.manualEntryMode,
    });
    if (!decision.allowed) {
      throw Forbidden(decision.reason ?? 'Not allowed');
    }

    // Duration of 0 → delegate to delete so the supersede chain is
    // restored cleanly.
    if (input.durationSeconds === 0) {
      await _deleteWithinTrx(trx, {
        row,
        reason: input.reason ?? 'Manual entry set to 0',
        actor: input.actor,
      });
      const refreshed = await trx<TimeEntryRow>('time_entries').where({ id: row.id }).first();
      return { entry: rowToTimeEntry(refreshed!), supersededEntryIds: [] };
    }

    const patch: Record<string, unknown> = {
      updated_at: trx.fn.now(),
      edited_by: input.actor.userId,
    };
    if (input.durationSeconds !== undefined) {
      patch.duration_seconds = input.durationSeconds;
      patch.ended_at = new Date(row.started_at.getTime() + input.durationSeconds * 1000);
    }
    if (input.reason !== undefined) {
      patch.entry_reason = input.reason;
      patch.edit_reason = input.reason;
    }

    await trx('time_entries').where({ id: row.id }).update(patch);

    await writeAudit(trx, {
      timeEntryId: row.id,
      companyId: input.companyId,
      actorUserId: input.actor.userId,
      action: 'manual_update',
      oldValue: {
        durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
        reason: row.entry_reason,
      },
      newValue: {
        durationSeconds: input.durationSeconds ?? null,
        reason: input.reason ?? null,
        typedInput: input.typedInput ?? null,
      },
      reason: input.reason ?? null,
    });

    const refreshed = await trx<TimeEntryRow>('time_entries').where({ id: row.id }).first();
    if (!refreshed) throw new Error('entry vanished after update');
    return { entry: rowToTimeEntry(refreshed), supersededEntryIds: [] };
  });
}

// ---------------------------------------------------------------------------
// Delete (soft) + restore superseded punches
// ---------------------------------------------------------------------------

export interface DeleteManualEntryInput {
  entryId: number;
  companyId: number;
  reason: string;
  actor: { userId: number; roleGlobal: GlobalRole };
}

export async function deleteManualEntry(input: DeleteManualEntryInput): Promise<void> {
  if (!input.reason.trim()) throw BadRequest('Reason is required for manual-entry delete');

  await db.transaction(async (trx) => {
    const row = await trx<TimeEntryRow>('time_entries')
      .where({ id: input.entryId, company_id: input.companyId })
      .whereNull('deleted_at')
      .forUpdate()
      .first();
    if (!row) throw NotFound('Manual entry not found');
    if (row.source !== 'web_manual') throw BadRequest('Target is not a manual entry');

    const config = await loadCompanyConfig(trx, input.companyId);
    const actorCtx = await loadActorContext(
      trx,
      { userId: input.actor.userId, roleGlobal: input.actor.roleGlobal },
      input.companyId,
      row.employee_id,
    );
    const decision = canManualEdit(actorCtx, {
      isApproved: !!row.approved_at,
      mode: config.manualEntryMode,
    });
    if (!decision.allowed) {
      throw Forbidden(decision.reason ?? 'Not allowed');
    }

    await _deleteWithinTrx(trx, { row, reason: input.reason, actor: input.actor });
  });
}

/** Shared delete body — used by deleteManualEntry and by the
 *  "duration=0 update" short-circuit so the supersede restore logic
 *  lives in exactly one place. */
async function _deleteWithinTrx(
  trx: Knex.Transaction,
  input: {
    row: TimeEntryRow;
    reason: string;
    actor: { userId: number; roleGlobal: GlobalRole };
  },
): Promise<void> {
  const { row } = input;
  const supersededIds: number[] = row.supersedes_entry_ids ?? [];

  // Soft-delete the manual entry.
  await trx('time_entries').where({ id: row.id }).update({
    deleted_at: trx.fn.now(),
    edited_by: input.actor.userId,
    edit_reason: input.reason,
    updated_at: trx.fn.now(),
  });

  // Restore the punches it superseded.
  if (supersededIds.length > 0) {
    await trx('time_entries')
      .whereIn('id', supersededIds)
      .where({ superseded_by_entry_id: row.id })
      .update({ superseded_by_entry_id: null, updated_at: trx.fn.now() });

    for (const id of supersededIds) {
      await writeAudit(trx, {
        timeEntryId: id,
        companyId: row.company_id,
        actorUserId: input.actor.userId,
        action: 'manual_revert',
        field: 'superseded_by_entry_id',
        oldValue: row.id,
        newValue: null,
        reason: input.reason,
      });
    }
  }

  await writeAudit(trx, {
    timeEntryId: row.id,
    companyId: row.company_id,
    actorUserId: input.actor.userId,
    action: 'manual_delete',
    reason: input.reason,
  });
}

// ---------------------------------------------------------------------------
// Employee-status check
// ---------------------------------------------------------------------------

async function ensureActiveEmployee(
  trx: Knex.Transaction,
  companyId: number,
  employeeId: number,
): Promise<void> {
  const row = await trx('employees')
    .where({ id: employeeId, company_id: companyId })
    .first<{ status: 'active' | 'terminated' }>();
  if (!row) throw NotFound('Employee not found');
  if (row.status !== 'active') throw Conflict('Employee is not active');
}

// ---------------------------------------------------------------------------
// Copy last week
// ---------------------------------------------------------------------------

export interface CopyLastWeekInput {
  companyId: number;
  employeeId: number;
  weekStart: string; // target week, YYYY-MM-DD company tz
  reason: string;
  actor: {
    userId: number;
    roleGlobal: GlobalRole;
    sourceIp?: string | null;
    sourceUserAgent?: string | null;
  };
}

/**
 * Duplicate every non-superseded work entry from the prior week into
 * the current week as `web_manual` rows with the supplied reason.
 * Days that already have ANY entry (punch or manual) are skipped so
 * we never clobber in-progress work.
 */
export async function copyLastWeek(input: CopyLastWeekInput): Promise<{
  createdCount: number;
  skippedCount: number;
  createdEntryIds: number[];
}> {
  if (!input.reason.trim()) throw BadRequest('Reason is required for copy-last-week');

  const config = await loadCompanyConfig(db, input.companyId);

  const prior = await db.raw<{ rows: Array<{ d: string }> }>(
    `SELECT to_char((?::date - INTERVAL '7 day')::date, 'YYYY-MM-DD') AS d`,
    [input.weekStart],
  );
  const priorWeekStart = prior.rows[0]!.d;

  // Source cells: seconds per (day, job) in the prior week, work entries only,
  // non-superseded. Aggregating here keeps us below the create-per-cell
  // partial unique index.
  const sourceRows = await db.raw<{
    rows: Array<{ day: string; job_id: number | null; seconds: string }>;
  }>(
    `
    SELECT
      to_char((started_at AT TIME ZONE ?)::date, 'YYYY-MM-DD') AS day,
      job_id,
      SUM(
        EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))
      )::bigint AS seconds
    FROM time_entries
    WHERE company_id = ?
      AND employee_id = ?
      AND entry_type = 'work'
      AND deleted_at IS NULL
      AND superseded_by_entry_id IS NULL
      AND started_at AT TIME ZONE ? >= (?::date)::timestamp
      AND started_at AT TIME ZONE ? < ((?::date) + INTERVAL '7 day')::timestamp
    GROUP BY day, job_id
    HAVING SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at)))::bigint > 0
    ORDER BY day, job_id NULLS LAST
    `,
    [
      config.timezone,
      input.companyId,
      input.employeeId,
      config.timezone,
      priorWeekStart,
      config.timezone,
      priorWeekStart,
    ],
  );

  let created = 0;
  let skipped = 0;
  const createdIds: number[] = [];

  for (const src of sourceRows.rows) {
    // Translate prior-week day → same-weekday in target week.
    const priorDate = new Date(src.day + 'T00:00:00Z');
    const targetDate = new Date(priorDate.getTime() + 7 * 86_400_000);
    const targetDay = targetDate.toISOString().slice(0, 10);

    // Skip any day that already has non-superseded entries for this
    // (employee, day) — any job. Prevents overwriting in-progress work.
    const existing = await db('time_entries')
      .where({ company_id: input.companyId, employee_id: input.employeeId })
      .whereNull('deleted_at')
      .whereNull('superseded_by_entry_id')
      .whereRaw(`date_trunc('day', started_at AT TIME ZONE ?) = ?::date`, [
        config.timezone,
        targetDay,
      ])
      .first<{ id: number }>();
    if (existing) {
      skipped += 1;
      continue;
    }

    try {
      const result = await createManualEntry({
        companyId: input.companyId,
        employeeId: input.employeeId,
        day: targetDay,
        jobId: src.job_id,
        durationSeconds: Math.min(86_400, Math.max(1, Number(src.seconds))),
        reason: input.reason,
        typedInput: 'copy-last-week',
        actor: input.actor,
      });
      created += 1;
      createdIds.push(result.entry.id);
    } catch {
      // Unique-index race or forbidden — just skip the cell rather than
      // abort the whole copy.
      skipped += 1;
    }
  }

  return { createdCount: created, skippedCount: skipped, createdEntryIds: createdIds };
}
