// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import QRCode from 'qrcode';
import type {
  BadgeEvent,
  BadgeEventType,
  EmployeeBadgeState,
  IssueBadgeResponse,
  KioskEmployeeContext,
} from '@vibept/shared';
import jwt from 'jsonwebtoken';
import type { Knex } from 'knex';
import { env } from '../config/env.js';
import { db } from '../db/knex.js';
import { Conflict, NotFound, TooManyRequests, Unauthorized } from '../http/errors.js';
import { generateBadgeToken, verifyBadgeToken } from './badge-crypto.js';
import type { KioskDeviceCtx } from './kiosk-verify.js';
import { isKioskBadgeLocked, recordKioskBadgeScan } from './kiosk-badge-lockout.js';
import { recordAuthEvent } from './auth-events.js';
import { getKioskEmployeeState } from './punch.js';

const KIOSK_EMPLOYEE_SESSION_TTL_SECONDS = 5 * 60;

interface EmployeeBadgeRow {
  id: number;
  company_id: number;
  first_name: string;
  last_name: string;
  status: string;
  badge_token_hash: string | null;
  badge_issued_at: Date | null;
  badge_revoked_at: Date | null;
  badge_version: number;
}

interface BadgeEventRow {
  id: number;
  company_id: number;
  employee_id: number | null;
  event_type: BadgeEventType;
  actor_user_id: number | null;
  kiosk_device_id: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

interface LogBadgeEventArgs {
  companyId: number;
  employeeId?: number | null;
  eventType: BadgeEventType;
  actorUserId?: number | null;
  kioskDeviceId?: number | null;
  metadata?: Record<string, unknown>;
  trx?: Knex.Transaction;
}

async function logBadgeEvent(args: LogBadgeEventArgs): Promise<void> {
  const q = args.trx ?? db;
  await q('badge_events').insert({
    company_id: args.companyId,
    employee_id: args.employeeId ?? null,
    event_type: args.eventType,
    actor_user_id: args.actorUserId ?? null,
    kiosk_device_id: args.kioskDeviceId ?? null,
    metadata: JSON.stringify(args.metadata ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export function describeBadgeState(row: EmployeeBadgeRow): EmployeeBadgeState {
  const state =
    row.badge_token_hash === null
      ? ('none' as const)
      : row.badge_revoked_at !== null
        ? ('revoked' as const)
        : ('active' as const);
  return {
    employeeId: row.id,
    state,
    version: row.badge_version,
    issuedAt: row.badge_issued_at?.toISOString() ?? null,
    revokedAt: row.badge_revoked_at?.toISOString() ?? null,
  };
}

export async function getBadgeState(
  companyId: number,
  employeeId: number,
): Promise<EmployeeBadgeState> {
  const row = await db<EmployeeBadgeRow>('employees')
    .where({ company_id: companyId, id: employeeId })
    .first();
  if (!row) throw NotFound('Employee not found');
  return describeBadgeState(row);
}

export async function getBadgeStatesForCompany(
  companyId: number,
): Promise<Record<number, EmployeeBadgeState>> {
  const rows = await db<EmployeeBadgeRow>('employees')
    .where({ company_id: companyId })
    .select('id', 'badge_token_hash', 'badge_issued_at', 'badge_revoked_at', 'badge_version');
  const out: Record<number, EmployeeBadgeState> = {};
  for (const r of rows) {
    out[r.id] = describeBadgeState({
      id: r.id,
      company_id: companyId,
      first_name: '',
      last_name: '',
      status: 'active',
      badge_token_hash: r.badge_token_hash,
      badge_issued_at: r.badge_issued_at,
      badge_revoked_at: r.badge_revoked_at,
      badge_version: r.badge_version,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

async function issueBadgeTx(
  trx: Knex.Transaction,
  companyId: number,
  employeeId: number,
  actorUserId: number | null,
): Promise<{ payload: string; version: number; issuedAt: Date }> {
  const existing = await trx<EmployeeBadgeRow>('employees')
    .where({ company_id: companyId, id: employeeId })
    .forUpdate()
    .first();
  if (!existing) throw NotFound('Employee not found');
  if (existing.status !== 'active') {
    throw Conflict('Cannot issue a badge to a terminated employee');
  }

  const nextVersion = existing.badge_version + 1;
  const { payload, hash } = generateBadgeToken({
    companyId,
    employeeId,
    badgeVersion: nextVersion,
  });
  const issuedAt = new Date();

  await trx('employees').where({ id: employeeId }).update({
    badge_token_hash: hash,
    badge_issued_at: issuedAt,
    badge_revoked_at: null,
    badge_version: nextVersion,
    updated_at: trx.fn.now(),
  });

  await logBadgeEvent({
    trx,
    companyId,
    employeeId,
    eventType: 'issue',
    actorUserId,
    metadata: { version: nextVersion },
  });

  return { payload, version: nextVersion, issuedAt };
}

export async function issueBadge(
  companyId: number,
  employeeId: number,
  actorUserId: number,
): Promise<IssueBadgeResponse> {
  const result = await db.transaction((trx) =>
    issueBadgeTx(trx, companyId, employeeId, actorUserId),
  );
  // QR PNG data URL rendered once for the modal + print sheet. Level-H
  // error correction tolerates laminate smudge / fold damage.
  const qrDataUrl = await QRCode.toDataURL(result.payload, {
    errorCorrectionLevel: 'H',
    margin: 1,
    scale: 6,
  });
  return {
    employeeId,
    payload: result.payload,
    version: result.version,
    issuedAt: result.issuedAt.toISOString(),
    qrDataUrl,
  };
}

// ---------------------------------------------------------------------------
// Revoke
// ---------------------------------------------------------------------------

export async function revokeBadge(
  companyId: number,
  employeeId: number,
  actorUserId: number,
  reason?: string,
): Promise<EmployeeBadgeState> {
  return db.transaction(async (trx) => {
    const existing = await trx<EmployeeBadgeRow>('employees')
      .where({ company_id: companyId, id: employeeId })
      .forUpdate()
      .first();
    if (!existing) throw NotFound('Employee not found');
    if (!existing.badge_token_hash) throw NotFound('Employee has no badge to revoke');
    if (existing.badge_revoked_at) {
      // Idempotent — already revoked, return current state without writing
      // another audit row.
      return describeBadgeState(existing);
    }

    await trx('employees').where({ id: employeeId }).update({
      badge_revoked_at: trx.fn.now(),
      updated_at: trx.fn.now(),
    });

    await logBadgeEvent({
      trx,
      companyId,
      employeeId,
      eventType: 'revoke',
      actorUserId,
      metadata: { reason: reason ?? null, version: existing.badge_version },
    });

    const fresh = await trx<EmployeeBadgeRow>('employees').where({ id: employeeId }).first();
    if (!fresh) throw new Error('employee vanished');
    return describeBadgeState(fresh);
  });
}

// ---------------------------------------------------------------------------
// Bulk issue (used by the Print/PDF badge sheet flow)
// ---------------------------------------------------------------------------

export interface BulkIssueResult {
  issued: Array<{
    employeeId: number;
    version: number;
    payload: string;
    firstName: string;
    lastName: string;
    employeeNumber: string | null;
  }>;
  skipped: Array<{ employeeId: number; reason: string }>;
}

export async function bulkIssueBadges(
  companyId: number,
  employeeIds: number[],
  actorUserId: number,
): Promise<BulkIssueResult> {
  // Single transaction so a mid-list failure rolls back every issued badge —
  // avoids a half-printed sheet where some employees have new versions and
  // some don't.
  return db.transaction(async (trx) => {
    const rows = await trx<EmployeeBadgeRow & { employee_number: string | null }>('employees')
      .whereIn('id', employeeIds)
      .where({ company_id: companyId });
    const byId = new Map(rows.map((r) => [r.id, r]));

    const out: BulkIssueResult = { issued: [], skipped: [] };
    for (const id of employeeIds) {
      const existing = byId.get(id);
      if (!existing) {
        out.skipped.push({ employeeId: id, reason: 'not_found' });
        continue;
      }
      if (existing.status !== 'active') {
        out.skipped.push({ employeeId: id, reason: 'terminated' });
        continue;
      }
      const issued = await issueBadgeTx(trx, companyId, id, actorUserId);
      out.issued.push({
        employeeId: id,
        version: issued.version,
        payload: issued.payload,
        firstName: existing.first_name,
        lastName: existing.last_name,
        employeeNumber: existing.employee_number ?? null,
      });
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// Verify (kiosk scan)
// ---------------------------------------------------------------------------

/** Matches the shape returned from PIN verify so the kiosk UI handles both
 *  auth paths identically. */
export async function verifyBadge(
  device: KioskDeviceCtx,
  rawPayload: string,
  ctx: { ip?: string | null; userAgent?: string | null },
): Promise<KioskEmployeeContext> {
  // 1) Rate limit check — before we do any crypto work, so a brute-force
  //    stream of garbage doesn't get free HMAC ops.
  const priorLock = isKioskBadgeLocked(device.id);
  if (priorLock.locked) {
    throw TooManyRequests(`Too many scans. Retry in ${Math.ceil(priorLock.retryAfterMs / 1000)}s`);
  }
  const rl = recordKioskBadgeScan(device.id);
  if (rl.locked) {
    // Current scan trips the limit; reject and log.
    await logBadgeEvent({
      companyId: device.companyId,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: { reason: 'rate_limited' },
    });
    throw TooManyRequests(`Too many scans. Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s`);
  }

  // 2) HMAC verify first — cheapest rejection path.
  const parsed = verifyBadgeToken(rawPayload);
  if (!parsed) {
    await logBadgeEvent({
      companyId: device.companyId,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: { reason: 'bad_hmac' },
    });
    await recordAuthEvent({
      eventType: 'login_failure',
      companyId: device.companyId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { kiosk_device_id: device.id, reason: 'badge_bad_hmac' },
    });
    throw Unauthorized('Badge not recognized');
  }

  // 3) Cross-company guard — a valid payload signed for another company
  //    must never authenticate on this kiosk. Coerce both sides through
  //    Number() because pg returns BIGINT columns as strings while the
  //    parsed payload companyId is a real number.
  if (Number(parsed.companyId) !== Number(device.companyId)) {
    await logBadgeEvent({
      companyId: device.companyId,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: { reason: 'cross_company', payload_company_id: parsed.companyId },
    });
    throw Unauthorized('Badge not recognized');
  }

  // 4) Look the employee up. A single indexed query; the partial unique
  //    index on (company_id, badge_token_hash) where not revoked makes
  //    this cheap.
  const employee = await db<EmployeeBadgeRow>('employees')
    .where({
      company_id: device.companyId,
      id: parsed.employeeId,
      status: 'active',
    })
    .first();

  if (!employee) {
    await logBadgeEvent({
      companyId: device.companyId,
      employeeId: parsed.employeeId,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: { reason: 'employee_missing' },
    });
    throw Unauthorized('Badge not recognized');
  }

  if (employee.badge_revoked_at !== null) {
    await logBadgeEvent({
      companyId: device.companyId,
      employeeId: employee.id,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: { reason: 'revoked' },
    });
    throw Unauthorized('Badge is no longer active');
  }

  if (parsed.badgeVersion !== employee.badge_version) {
    await logBadgeEvent({
      companyId: device.companyId,
      employeeId: employee.id,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: {
        reason: 'version_mismatch',
        payload_version: parsed.badgeVersion,
        current_version: employee.badge_version,
      },
    });
    throw Unauthorized('Badge has been superseded — see your manager');
  }

  if (!employee.badge_token_hash || employee.badge_token_hash !== parsed.hash) {
    // HMAC passed but the stored hash doesn't match — either the hash
    // column was cleared out of band, or there's a silent tampering
    // attack we should log loudly.
    await logBadgeEvent({
      companyId: device.companyId,
      employeeId: employee.id,
      eventType: 'scan_failure',
      kioskDeviceId: device.id,
      metadata: { reason: 'hash_mismatch' },
    });
    throw Unauthorized('Badge not recognized');
  }

  // Success — mint the same short-lived session token the PIN flow uses.
  const sessionToken = jwt.sign(
    {
      sub: String(employee.id),
      typ: 'kiosk_employee',
      kioskDeviceId: device.id,
      companyId: device.companyId,
    },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: KIOSK_EMPLOYEE_SESSION_TTL_SECONDS },
  );

  await logBadgeEvent({
    companyId: device.companyId,
    employeeId: employee.id,
    eventType: 'scan_success',
    kioskDeviceId: device.id,
    metadata: { version: employee.badge_version },
  });
  await recordAuthEvent({
    eventType: 'login_success',
    companyId: device.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: {
      kiosk_device_id: device.id,
      employee_id: employee.id,
      method: 'qr_badge',
    },
  });

  const { openEntry, todayWorkSeconds } = await getKioskEmployeeState(
    device.companyId,
    employee.id,
  );

  return {
    employeeId: employee.id,
    firstName: employee.first_name,
    lastName: employee.last_name,
    sessionToken,
    openEntry,
    todayWorkSeconds,
  };
}

// ---------------------------------------------------------------------------
// Events list
// ---------------------------------------------------------------------------

export async function listBadgeEventsForEmployee(
  companyId: number,
  employeeId: number,
  limit = 20,
): Promise<BadgeEvent[]> {
  const rows = await db<BadgeEventRow>('badge_events')
    .where({ company_id: companyId, employee_id: employeeId })
    .orderBy('created_at', 'desc')
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    eventType: r.event_type,
    employeeId: r.employee_id,
    actorUserId: r.actor_user_id,
    kioskDeviceId: r.kiosk_device_id,
    metadata: r.metadata,
    createdAt: r.created_at.toISOString(),
  }));
}
