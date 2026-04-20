import crypto from 'node:crypto';
import type {
  CreateKioskPairingCodeRequest,
  KioskDevice,
  KioskPairingCodeResponse,
  PairKioskRequest,
  PairKioskResponse,
} from '@vibept/shared';
import { KIOSK_PAIRING_CODE_TTL_SECONDS } from '@vibept/shared';
import { db } from '../db/knex.js';
import { BadRequest, NotFound, Unauthorized } from '../http/errors.js';
import { recordAuthEvent } from './auth-events.js';

interface KioskDeviceRow {
  id: number;
  company_id: number;
  name: string;
  token_hash: string;
  paired_at: Date;
  last_seen_at: Date | null;
  revoked_at: Date | null;
  pairing_code_id: number | null;
}

function rowToDevice(row: KioskDeviceRow): KioskDevice {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    pairedAt: row.paired_at.toISOString(),
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

function generatePairingCode(): string {
  // 8 digits — human-typeable on a tablet keypad, 10^8 space.
  const buf = crypto.randomBytes(4);
  const num = buf.readUInt32BE(0) % 100_000_000;
  return num.toString().padStart(8, '0');
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Admin endpoints
// ---------------------------------------------------------------------------

export async function issuePairingCode(
  companyId: number,
  actorUserId: number,
  _body: CreateKioskPairingCodeRequest,
): Promise<KioskPairingCodeResponse> {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + KIOSK_PAIRING_CODE_TTL_SECONDS * 1000);
  await db('kiosk_pairing_codes').insert({
    company_id: companyId,
    code,
    expires_at: expiresAt,
    issued_by: actorUserId,
  });
  return { code, expiresAt: expiresAt.toISOString() };
}

export async function listKioskDevices(companyId: number): Promise<KioskDevice[]> {
  const rows = await db<KioskDeviceRow>('kiosk_devices')
    .where({ company_id: companyId })
    .orderBy('paired_at', 'desc');
  return rows.map(rowToDevice);
}

export async function renameKioskDevice(
  companyId: number,
  deviceId: number,
  name: string,
): Promise<KioskDevice> {
  const existing = await db<KioskDeviceRow>('kiosk_devices')
    .where({ company_id: companyId, id: deviceId })
    .first();
  if (!existing) throw NotFound('Kiosk device not found');
  await db('kiosk_devices').where({ id: deviceId }).update({ name });
  const fresh = await db<KioskDeviceRow>('kiosk_devices').where({ id: deviceId }).first();
  if (!fresh) throw new Error('device vanished');
  return rowToDevice(fresh);
}

export async function revokeKioskDevice(
  companyId: number,
  deviceId: number,
  actorUserId: number,
): Promise<void> {
  const existing = await db<KioskDeviceRow>('kiosk_devices')
    .where({ company_id: companyId, id: deviceId })
    .first();
  if (!existing) throw NotFound('Kiosk device not found');
  if (existing.revoked_at) return;
  await db('kiosk_devices')
    .where({ id: deviceId })
    .update({ revoked_at: db.fn.now() });
  await recordAuthEvent({
    eventType: 'logout',
    userId: actorUserId,
    companyId,
    metadata: { kiosk_device_id: deviceId, action: 'kiosk_revoke' },
  });
}

// ---------------------------------------------------------------------------
// Tablet endpoints
// ---------------------------------------------------------------------------

/**
 * Consume a pairing code atomically: SELECT FOR UPDATE to prevent two
 * tablets from using the same code concurrently, check expiry + consumption
 * in the same transaction, then insert the device.
 */
export async function pairKiosk(
  body: PairKioskRequest,
  ctx: { ip?: string | null; userAgent?: string | null },
): Promise<PairKioskResponse> {
  return db.transaction(async (trx) => {
    const code = await trx('kiosk_pairing_codes')
      .where({ code: body.code })
      .whereNull('consumed_at')
      .forUpdate()
      .first<{ id: number; company_id: number; expires_at: Date }>();
    if (!code) throw Unauthorized('Invalid or used pairing code');
    if (code.expires_at.getTime() < Date.now()) {
      throw Unauthorized('Pairing code has expired');
    }

    const company = await trx('companies')
      .where({ id: code.company_id })
      .first<{ name: string }>();
    if (!company) throw NotFound('Company not found');

    const deviceToken = crypto.randomBytes(48).toString('base64url');
    const [device] = await trx<KioskDeviceRow>('kiosk_devices')
      .insert({
        company_id: code.company_id,
        name: body.deviceName,
        token_hash: sha256Hex(deviceToken),
        pairing_code_id: code.id,
      })
      .returning('*');
    if (!device) throw new Error('failed to create kiosk device');

    await trx('kiosk_pairing_codes')
      .where({ id: code.id })
      .update({ consumed_at: trx.fn.now() });

    await recordAuthEvent(
      {
        eventType: 'setup_initial',
        companyId: code.company_id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { kiosk_paired_device_id: device.id, action: 'kiosk_pair' },
      },
      trx,
    );

    return {
      deviceToken,
      device: rowToDevice(device),
      companyName: company.name,
    };
  });
}

// ---------------------------------------------------------------------------
// Token resolution (used by the kiosk auth middleware)
// ---------------------------------------------------------------------------

export interface ResolvedKioskDevice {
  id: number;
  companyId: number;
  name: string;
}

export async function resolveKioskToken(token: string): Promise<ResolvedKioskDevice | null> {
  const hash = sha256Hex(token);
  const row = await db<KioskDeviceRow>('kiosk_devices')
    .where({ token_hash: hash })
    .whereNull('revoked_at')
    .first();
  if (!row) return null;

  // Best-effort last-seen update — fire-and-forget is fine.
  db('kiosk_devices')
    .where({ id: row.id })
    .update({ last_seen_at: db.fn.now() })
    .catch(() => undefined);

  return { id: row.id, companyId: row.company_id, name: row.name };
}

export function ensurePairingRequest(body: Partial<PairKioskRequest>): PairKioskRequest {
  if (!body.code || !body.deviceName) {
    throw BadRequest('code and deviceName are required');
  }
  return body as PairKioskRequest;
}
