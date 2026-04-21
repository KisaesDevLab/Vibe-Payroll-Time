import type { PunchSource, TimeEntry } from '@vibept/shared';
import { OFFLINE_PUNCH_MAX_AGE_SECONDS } from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { BadRequest, Conflict, NotFound } from '../http/errors.js';

// ---------------------------------------------------------------------------
// Row shape + row→resource mapping
// ---------------------------------------------------------------------------

export interface TimeEntryRow {
  id: number;
  company_id: number;
  employee_id: number;
  shift_id: string;
  entry_type: 'work' | 'break';
  job_id: number | null;
  started_at: Date;
  ended_at: Date | null;
  duration_seconds: string | number | null;
  source: PunchSource;
  source_device_id: string | null;
  source_offline: boolean;
  source_ip: string | null;
  source_user_agent: string | null;
  client_started_at: Date | null;
  client_clock_skew_ms: number | null;
  created_by: number | null;
  edited_by: number | null;
  edit_reason: string | null;
  approved_at: Date | null;
  approved_by: number | null;
  is_auto_closed: boolean;
  entry_reason: string | null;
  superseded_by_entry_id: number | null;
  supersedes_entry_ids: number[] | null;
  is_manual: boolean;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function rowToTimeEntry(row: TimeEntryRow): TimeEntry {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    shiftId: row.shift_id,
    entryType: row.entry_type,
    jobId: row.job_id,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    source: row.source,
    sourceOffline: row.source_offline,
    sourceIp: row.source_ip,
    sourceUserAgent: row.source_user_agent,
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedBy: row.approved_by,
    isAutoClosed: row.is_auto_closed,
    entryReason: row.entry_reason,
    supersededByEntryId: row.superseded_by_entry_id,
    supersedesEntryIds: row.supersedes_entry_ids,
    isManual: row.is_manual,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Shared input type for every mutation. Keeping it uniform lets the HTTP
// layer shape both user-auth and kiosk-auth calls into the same service
// invocation.
// ---------------------------------------------------------------------------

export interface PunchContext {
  companyId: number;
  employeeId: number;
  source: PunchSource;
  sourceDeviceId?: string | null;
  /** Appliance user who triggered the punch. For kiosk-only employees
   *  (no user account) this is null; source + source_device_id capture
   *  the origin. Cron-driven closes are also null. */
  actorUserId: number | null;
  /** Network attribution captured at the HTTP layer. Nullable — cron
   *  paths (auto-clock-out) and test fixtures have no request, and
   *  legacy rows pre-date this migration. */
  sourceIp?: string | null;
  sourceUserAgent?: string | null;
  /** Optional offline metadata. When present, `started_at` is
   *  client_started_at adjusted for skew. */
  clientStartedAt?: string | undefined;
  clientClockSkewMs?: number | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the authoritative server timestamp for a mutation. Online
 * punches use NOW(); offline punches use the client's claim adjusted for
 * their clock skew, floored by NOW() and bounded by the 72-hour retention.
 */
function resolveStartedAt(ctx: PunchContext): {
  startedAt: Date;
  isOffline: boolean;
  rawClientStartedAt: Date | null;
  clockSkewMs: number | null;
} {
  if (!ctx.clientStartedAt) {
    return {
      startedAt: new Date(),
      isOffline: false,
      rawClientStartedAt: null,
      clockSkewMs: null,
    };
  }

  const client = new Date(ctx.clientStartedAt);
  if (Number.isNaN(client.getTime())) throw BadRequest('Invalid clientStartedAt');

  const skew = ctx.clientClockSkewMs ?? 0;
  let adjusted = new Date(client.getTime() + skew);

  // Clamp to NOW() if the adjusted time is somehow in the future — clocks
  // lie, and the audit trail must keep causality.
  const now = new Date();
  if (adjusted.getTime() > now.getTime()) adjusted = now;

  const ageSeconds = (now.getTime() - adjusted.getTime()) / 1000;
  if (ageSeconds > OFFLINE_PUNCH_MAX_AGE_SECONDS) {
    throw BadRequest(
      `Offline punch is older than ${OFFLINE_PUNCH_MAX_AGE_SECONDS / 3600}h and was rejected`,
    );
  }

  return {
    startedAt: adjusted,
    isOffline: true,
    rawClientStartedAt: client,
    clockSkewMs: skew,
  };
}

/**
 * Acquire a per-employee advisory lock for the life of the transaction.
 * Serializes every mutation for a single employee — no two clock-ins race,
 * no break-in interleaves with a clock-out from the other auth surface.
 *
 * pg_advisory_xact_lock is released on commit/rollback; we don't have to
 * unlock explicitly.
 */
async function lockEmployee(trx: Knex.Transaction, employeeId: number): Promise<void> {
  await trx.raw('SELECT pg_advisory_xact_lock(?)', [employeeId]);
}

async function findOpenEntry(
  trx: Knex.Transaction,
  companyId: number,
  employeeId: number,
): Promise<TimeEntryRow | undefined> {
  return trx<TimeEntryRow>('time_entries')
    .where({ company_id: companyId, employee_id: employeeId })
    .whereNull('ended_at')
    .whereNull('deleted_at')
    .first();
}

// ---------------------------------------------------------------------------
// Read-only state used by the kiosk + PWA "current punch state" views. Split
// from findOpenEntry (which takes a trx) because these reads happen outside
// any mutation — kiosk PIN verify, badge scan, personal-device dashboard.
// ---------------------------------------------------------------------------

/** Narrow view used by the kiosk PIN + badge verify responses. */
export interface KioskEmployeeState {
  openEntry: { entryType: 'work' | 'break'; startedAt: string } | null;
  todayWorkSeconds: number;
}

/** Full open-entry row lookup — shared by kiosk and PWA current-state reads. */
export async function getOpenEntry(
  companyId: number,
  employeeId: number,
): Promise<TimeEntryRow | null> {
  const row = await db<TimeEntryRow>('time_entries')
    .where({ company_id: companyId, employee_id: employeeId })
    .whereNull('ended_at')
    .whereNull('deleted_at')
    .first();
  return row ?? null;
}

/**
 * Today's work-seconds running total, evaluated in the company's local
 * timezone. Every work entry — completed OR still open — is clipped to the
 * [local midnight, local midnight + 24h] window and summed. Correctly
 * attributes overnight shifts to both days: an 11 PM → 2 AM shift
 * contributes 1 hour to the starting day and 2 hours to the next.
 */
export async function getTodayWorkSeconds(companyId: number, employeeId: number): Promise<number> {
  const company = await db('companies').where({ id: companyId }).first<{ timezone: string }>();
  const tz = company?.timezone ?? 'UTC';

  const result = await db.raw<{
    rows: Array<{ seconds: string | number | null }>;
  }>(
    `
    WITH bounds AS (
      SELECT
        (date_trunc('day', NOW() AT TIME ZONE ?) AT TIME ZONE ?) AS day_start,
        ((date_trunc('day', NOW() AT TIME ZONE ?) + INTERVAL '1 day') AT TIME ZONE ?) AS day_end
    )
    SELECT COALESCE(SUM(
      EXTRACT(EPOCH FROM (
        LEAST(COALESCE(te.ended_at, NOW()), b.day_end)
          - GREATEST(te.started_at, b.day_start)
      ))
    ), 0)::bigint AS seconds
    FROM time_entries te
    CROSS JOIN bounds b
    WHERE te.company_id = ?
      AND te.employee_id = ?
      AND te.deleted_at IS NULL
      AND te.entry_type = 'work'
      AND te.started_at < b.day_end
      AND COALESCE(te.ended_at, NOW()) > b.day_start
    `,
    [tz, tz, tz, tz, companyId, employeeId],
  );
  const raw = result.rows[0]?.seconds ?? 0;
  return Math.max(0, Math.floor(Number(raw)));
}

/**
 * Bundled state for the kiosk verify + scan responses — the UI needs both
 * the open entry shape and today's running total to render the right
 * action buttons.
 */
export async function getKioskEmployeeState(
  companyId: number,
  employeeId: number,
): Promise<KioskEmployeeState> {
  const [open, todayWorkSeconds] = await Promise.all([
    getOpenEntry(companyId, employeeId),
    getTodayWorkSeconds(companyId, employeeId),
  ]);
  return {
    openEntry: open
      ? {
          entryType: open.entry_type,
          startedAt: open.started_at.toISOString(),
        }
      : null,
    todayWorkSeconds,
  };
}

async function writeAudit(
  trx: Knex.Transaction,
  input: {
    timeEntryId: number;
    companyId: number;
    actorUserId: number | null;
    action: 'create' | 'edit' | 'approve' | 'unapprove' | 'delete' | 'auto_close';
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

async function ensureJobBelongsToCompany(
  trx: Knex.Transaction,
  companyId: number,
  jobId: number,
): Promise<void> {
  const row = await trx('jobs')
    .where({ id: jobId, company_id: companyId })
    .whereNull('archived_at')
    .first<{ id: number }>();
  if (!row) throw NotFound('Active job not found for this company');
}

/** Return the `job_id` from the last non-break entry in a shift — used so
 *  breakOut resumes on the same job the employee left. */
async function lastWorkJobForShift(trx: Knex.Transaction, shiftId: string): Promise<number | null> {
  const row = await trx<TimeEntryRow>('time_entries')
    .where({ shift_id: shiftId, entry_type: 'work' })
    .whereNull('deleted_at')
    .orderBy('started_at', 'desc')
    .first();
  return row?.job_id ?? null;
}

function secondsBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 1000));
}

function nextAfterClose(close: Date): Date {
  // Open entries must have started_at > previous ended_at for the CHECK
  // constraint on any future close to succeed. Using ms-precision `Date`
  // directly works because postgres stores with microsecond precision;
  // we'll never observe the same instant twice thanks to advisory locks.
  return close;
}

// ---------------------------------------------------------------------------
// Mutations — every path goes through here. Each opens a trx, locks the
// employee, reads the open entry, performs the state transition, writes
// an audit row, and returns the resulting entry.
// ---------------------------------------------------------------------------

export async function clockIn(
  ctx: PunchContext,
  opts: { jobId?: number | null } = {},
): Promise<TimeEntry> {
  return db.transaction(async (trx) => {
    await ensureActiveEmployee(trx, ctx.companyId, ctx.employeeId);
    if (opts.jobId) await ensureJobBelongsToCompany(trx, ctx.companyId, opts.jobId);
    await lockEmployee(trx, ctx.employeeId);

    const open = await findOpenEntry(trx, ctx.companyId, ctx.employeeId);
    if (open) throw Conflict('Employee already has an open entry');

    const { startedAt, isOffline, rawClientStartedAt, clockSkewMs } = resolveStartedAt(ctx);

    const [row] = await trx<TimeEntryRow>('time_entries')
      .insert({
        company_id: ctx.companyId,
        employee_id: ctx.employeeId,
        shift_id: trx.raw('gen_random_uuid()'),
        entry_type: 'work',
        job_id: opts.jobId ?? null,
        started_at: startedAt,
        source: ctx.source,
        source_device_id: ctx.sourceDeviceId ?? null,
        source_offline: isOffline,
        source_ip: ctx.sourceIp ?? null,
        source_user_agent: ctx.sourceUserAgent ?? null,
        client_started_at: rawClientStartedAt,
        client_clock_skew_ms: clockSkewMs,
        created_by: ctx.actorUserId,
      })
      .returning('*');
    if (!row) throw new Error('clockIn insert returned no row');

    await writeAudit(trx, {
      timeEntryId: row.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'create',
      newValue: {
        entryType: 'work',
        jobId: row.job_id,
        startedAt: row.started_at.toISOString(),
        source: row.source,
        sourceOffline: row.source_offline,
      },
    });

    return rowToTimeEntry(row);
  });
}

async function closeOpen(
  trx: Knex.Transaction,
  ctx: PunchContext,
  requireType: 'work' | 'break' | 'any',
  endedAt: Date,
): Promise<TimeEntryRow> {
  const open = await findOpenEntry(trx, ctx.companyId, ctx.employeeId);
  if (!open) throw Conflict('Employee has no open entry');
  if (requireType !== 'any' && open.entry_type !== requireType) {
    throw Conflict(`Employee's open entry is ${open.entry_type}, not ${requireType}`);
  }
  if (endedAt.getTime() < open.started_at.getTime()) {
    // Should not happen after clamping, but explicit guard.
    throw BadRequest('Close time precedes open time');
  }
  const duration = secondsBetween(open.started_at, endedAt);
  await trx('time_entries').where({ id: open.id }).update({
    ended_at: endedAt,
    duration_seconds: duration,
    updated_at: trx.fn.now(),
  });
  return { ...open, ended_at: endedAt, duration_seconds: duration };
}

export async function clockOut(ctx: PunchContext): Promise<TimeEntry> {
  return db.transaction(async (trx) => {
    await lockEmployee(trx, ctx.employeeId);
    const { startedAt: endedAt } = resolveStartedAt(ctx);
    const closed = await closeOpen(trx, ctx, 'any', endedAt);

    await writeAudit(trx, {
      timeEntryId: closed.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'edit',
      field: 'ended_at',
      oldValue: null,
      newValue: endedAt.toISOString(),
    });

    return rowToTimeEntry(closed);
  });
}

export async function breakIn(ctx: PunchContext): Promise<TimeEntry> {
  return db.transaction(async (trx) => {
    await lockEmployee(trx, ctx.employeeId);
    const { startedAt: pivot, isOffline, rawClientStartedAt, clockSkewMs } = resolveStartedAt(ctx);

    const closed = await closeOpen(trx, ctx, 'work', pivot);
    await writeAudit(trx, {
      timeEntryId: closed.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'edit',
      field: 'ended_at',
      newValue: pivot.toISOString(),
      reason: 'break_in',
    });

    const [row] = await trx<TimeEntryRow>('time_entries')
      .insert({
        company_id: ctx.companyId,
        employee_id: ctx.employeeId,
        shift_id: closed.shift_id,
        entry_type: 'break',
        job_id: null,
        started_at: nextAfterClose(pivot),
        source: ctx.source,
        source_device_id: ctx.sourceDeviceId ?? null,
        source_offline: isOffline,
        source_ip: ctx.sourceIp ?? null,
        source_user_agent: ctx.sourceUserAgent ?? null,
        client_started_at: rawClientStartedAt,
        client_clock_skew_ms: clockSkewMs,
        created_by: ctx.actorUserId,
      })
      .returning('*');
    if (!row) throw new Error('breakIn insert returned no row');

    await writeAudit(trx, {
      timeEntryId: row.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'create',
      newValue: { entryType: 'break', shiftId: row.shift_id },
    });

    return rowToTimeEntry(row);
  });
}

export async function breakOut(ctx: PunchContext): Promise<TimeEntry> {
  return db.transaction(async (trx) => {
    await lockEmployee(trx, ctx.employeeId);
    const { startedAt: pivot, isOffline, rawClientStartedAt, clockSkewMs } = resolveStartedAt(ctx);

    const closed = await closeOpen(trx, ctx, 'break', pivot);
    await writeAudit(trx, {
      timeEntryId: closed.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'edit',
      field: 'ended_at',
      newValue: pivot.toISOString(),
      reason: 'break_out',
    });

    // Resume on the same job the employee was on pre-break.
    const resumeJobId = await lastWorkJobForShift(trx, closed.shift_id);

    const [row] = await trx<TimeEntryRow>('time_entries')
      .insert({
        company_id: ctx.companyId,
        employee_id: ctx.employeeId,
        shift_id: closed.shift_id,
        entry_type: 'work',
        job_id: resumeJobId,
        started_at: nextAfterClose(pivot),
        source: ctx.source,
        source_device_id: ctx.sourceDeviceId ?? null,
        source_offline: isOffline,
        source_ip: ctx.sourceIp ?? null,
        source_user_agent: ctx.sourceUserAgent ?? null,
        client_started_at: rawClientStartedAt,
        client_clock_skew_ms: clockSkewMs,
        created_by: ctx.actorUserId,
      })
      .returning('*');
    if (!row) throw new Error('breakOut insert returned no row');

    await writeAudit(trx, {
      timeEntryId: row.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'create',
      newValue: { entryType: 'work', shiftId: row.shift_id, jobId: resumeJobId },
    });

    return rowToTimeEntry(row);
  });
}

export async function switchJob(ctx: PunchContext, newJobId: number): Promise<TimeEntry> {
  return db.transaction(async (trx) => {
    await ensureJobBelongsToCompany(trx, ctx.companyId, newJobId);
    await lockEmployee(trx, ctx.employeeId);
    const { startedAt: pivot, isOffline, rawClientStartedAt, clockSkewMs } = resolveStartedAt(ctx);

    const closed = await closeOpen(trx, ctx, 'work', pivot);
    await writeAudit(trx, {
      timeEntryId: closed.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'edit',
      field: 'ended_at',
      newValue: pivot.toISOString(),
      reason: 'switch_job',
    });

    const [row] = await trx<TimeEntryRow>('time_entries')
      .insert({
        company_id: ctx.companyId,
        employee_id: ctx.employeeId,
        shift_id: closed.shift_id,
        entry_type: 'work',
        job_id: newJobId,
        started_at: nextAfterClose(pivot),
        source: ctx.source,
        source_device_id: ctx.sourceDeviceId ?? null,
        source_offline: isOffline,
        source_ip: ctx.sourceIp ?? null,
        source_user_agent: ctx.sourceUserAgent ?? null,
        client_started_at: rawClientStartedAt,
        client_clock_skew_ms: clockSkewMs,
        created_by: ctx.actorUserId,
      })
      .returning('*');
    if (!row) throw new Error('switchJob insert returned no row');

    await writeAudit(trx, {
      timeEntryId: row.id,
      companyId: ctx.companyId,
      actorUserId: ctx.actorUserId,
      action: 'create',
      newValue: { entryType: 'work', shiftId: row.shift_id, jobId: newJobId },
    });

    return rowToTimeEntry(row);
  });
}

// ---------------------------------------------------------------------------
// Edit / approve / delete — used by the timesheet review flows in Phase 6.
// ---------------------------------------------------------------------------

export interface EditEntryPatch {
  startedAt?: string;
  endedAt?: string | null;
  jobId?: number | null;
  entryType?: 'work' | 'break';
}

export async function editEntry(
  entryId: number,
  patch: EditEntryPatch,
  actor: { userId: number; companyId: number },
  reason: string,
): Promise<TimeEntry> {
  return db.transaction(async (trx) => {
    const existing = await trx<TimeEntryRow>('time_entries')
      .where({ id: entryId, company_id: actor.companyId })
      .whereNull('deleted_at')
      .forUpdate()
      .first();
    if (!existing) throw NotFound('Time entry not found');
    if (patch.jobId) await ensureJobBelongsToCompany(trx, actor.companyId, patch.jobId);

    const updates: Record<string, unknown> = {
      edited_by: actor.userId,
      edit_reason: reason,
      updated_at: trx.fn.now(),
    };
    const auditEntries: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    if (patch.startedAt !== undefined) {
      const newStart = new Date(patch.startedAt);
      if (Number.isNaN(newStart.getTime())) throw BadRequest('Invalid startedAt');
      updates.started_at = newStart;
      auditEntries.push({
        field: 'started_at',
        oldValue: existing.started_at.toISOString(),
        newValue: newStart.toISOString(),
      });
    }
    if (patch.endedAt !== undefined) {
      const newEnd = patch.endedAt ? new Date(patch.endedAt) : null;
      if (newEnd && Number.isNaN(newEnd.getTime())) throw BadRequest('Invalid endedAt');
      updates.ended_at = newEnd;
      auditEntries.push({
        field: 'ended_at',
        oldValue: existing.ended_at?.toISOString() ?? null,
        newValue: newEnd?.toISOString() ?? null,
      });
    }
    // Recompute duration whenever start or end changed — handles both-edited
    // and either-edited cases against the resulting effective times.
    if (patch.startedAt !== undefined || patch.endedAt !== undefined) {
      const effectiveStart = (updates.started_at as Date | undefined) ?? existing.started_at;
      const effectiveEnd =
        patch.endedAt !== undefined ? (updates.ended_at as Date | null) : existing.ended_at;
      updates.duration_seconds = effectiveEnd ? secondsBetween(effectiveStart, effectiveEnd) : null;
    }
    if (patch.jobId !== undefined) {
      updates.job_id = patch.jobId;
      auditEntries.push({
        field: 'job_id',
        oldValue: existing.job_id,
        newValue: patch.jobId,
      });
    }
    if (patch.entryType !== undefined) {
      updates.entry_type = patch.entryType;
      auditEntries.push({
        field: 'entry_type',
        oldValue: existing.entry_type,
        newValue: patch.entryType,
      });
    }

    if (auditEntries.length === 0) return rowToTimeEntry(existing);

    await trx('time_entries').where({ id: entryId }).update(updates);
    for (const a of auditEntries) {
      await writeAudit(trx, {
        timeEntryId: entryId,
        companyId: actor.companyId,
        actorUserId: actor.userId,
        action: 'edit',
        field: a.field,
        oldValue: a.oldValue,
        newValue: a.newValue,
        reason,
      });
    }

    const fresh = await trx<TimeEntryRow>('time_entries').where({ id: entryId }).first();
    if (!fresh) throw new Error('entry vanished after edit');
    return rowToTimeEntry(fresh);
  });
}

export async function deleteEntry(
  entryId: number,
  actor: { userId: number; companyId: number },
  reason: string,
): Promise<void> {
  await db.transaction(async (trx) => {
    const existing = await trx<TimeEntryRow>('time_entries')
      .where({ id: entryId, company_id: actor.companyId })
      .whereNull('deleted_at')
      .first();
    if (!existing) throw NotFound('Time entry not found');

    await trx('time_entries').where({ id: entryId }).update({
      deleted_at: trx.fn.now(),
      edited_by: actor.userId,
      edit_reason: reason,
      updated_at: trx.fn.now(),
    });

    await writeAudit(trx, {
      timeEntryId: entryId,
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: 'delete',
      reason,
    });
  });
}

// ---------------------------------------------------------------------------
// Admin / supervisor: create an entry from scratch (missed-punch recovery).
// ---------------------------------------------------------------------------

export interface CreateEntryInput {
  employeeId: number;
  startedAt: string; // ISO
  endedAt: string; // ISO — closed entries only; open entries must come from actual punches
  entryType: 'work' | 'break';
  jobId?: number | null;
  reason: string;
}

/**
 * Insert a complete (closed) time entry on behalf of an employee. Used
 * by the supervisor "Joe forgot to clock in yesterday" flow. Refuses to
 * create overlapping entries against existing non-deleted rows, and
 * records the audit as `action=create` with the supplied reason.
 *
 * Intentionally requires `endedAt` — open entries are the employee's
 * own action via kiosk/PWA, and a supervisor creating one would
 * conflict with the partial-unique "one open entry" index.
 */
export async function createEntryForEmployee(
  input: CreateEntryInput,
  actor: {
    userId: number;
    companyId: number;
    sourceIp?: string | null;
    sourceUserAgent?: string | null;
  },
): Promise<TimeEntry> {
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  if (Number.isNaN(startedAt.getTime())) throw BadRequest('Invalid startedAt');
  if (Number.isNaN(endedAt.getTime())) throw BadRequest('Invalid endedAt');
  if (endedAt <= startedAt) throw BadRequest('endedAt must be after startedAt');

  return db.transaction(async (trx) => {
    await ensureActiveEmployee(trx, actor.companyId, input.employeeId);
    if (input.jobId != null) {
      await ensureJobBelongsToCompany(trx, actor.companyId, input.jobId);
    }

    // Overlap check. Two ranges overlap when a.start < b.end AND a.end > b.start.
    // Unclosed entries (ended_at IS NULL) are treated as extending to +inf.
    const overlap = await trx<TimeEntryRow>('time_entries')
      .where({ company_id: actor.companyId, employee_id: input.employeeId })
      .whereNull('deleted_at')
      .where('started_at', '<', endedAt)
      .andWhere((qb) => {
        qb.whereNull('ended_at').orWhere('ended_at', '>', startedAt);
      })
      .first();
    if (overlap) {
      throw Conflict('Proposed entry overlaps with an existing entry for this employee');
    }

    const [row] = await trx<TimeEntryRow>('time_entries')
      .insert({
        company_id: actor.companyId,
        employee_id: input.employeeId,
        shift_id: trx.raw('gen_random_uuid()'),
        entry_type: input.entryType,
        job_id: input.entryType === 'work' ? (input.jobId ?? null) : null,
        started_at: startedAt,
        ended_at: endedAt,
        duration_seconds: secondsBetween(startedAt, endedAt),
        source: 'web',
        source_device_id: `web-admin-${actor.userId}`,
        source_ip: actor.sourceIp ?? null,
        source_user_agent: actor.sourceUserAgent ?? null,
        created_by: actor.userId,
        edited_by: actor.userId,
        edit_reason: input.reason,
      })
      .returning<TimeEntryRow[]>('*');
    if (!row) throw new Error('failed to insert time entry');

    await writeAudit(trx, {
      timeEntryId: row.id,
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action: 'create',
      reason: input.reason,
      newValue: {
        entryType: input.entryType,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        jobId: row.job_id,
      },
    });

    return rowToTimeEntry(row);
  });
}
