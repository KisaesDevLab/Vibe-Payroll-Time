import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { KioskEmployeeContext } from '@vibept/shared';
import { env } from '../config/env.js';
import { db } from '../db/knex.js';
import { Unauthorized } from '../http/errors.js';
import { recordAuthEvent } from './auth-events.js';
import { pinFingerprint } from './crypto.js';
import {
  isDeviceLocked,
  recordBadPin,
  recordGoodPin,
} from './kiosk-pin-lockout.js';
import { verifyPin } from './passwords.js';

/** Kiosk employee session TTL — short so a walk-away from the tablet
 *  doesn't leave a punchable session. */
const KIOSK_EMPLOYEE_SESSION_TTL_SECONDS = 5 * 60;

export interface KioskDeviceCtx {
  id: number;
  companyId: number;
}

export interface KioskEmployeeSessionClaims {
  sub: string;
  typ: 'kiosk_employee';
  kioskDeviceId: number;
  companyId: number;
  iat?: number;
  exp?: number;
}

/**
 * Verify a PIN submitted at the kiosk:
 *   1. Check device lockout state.
 *   2. Compute the keyed fingerprint and look up the active employee in the
 *      device's company (one indexed query).
 *   3. If there's a row, bcrypt-verify against `pin_hash` as defense against
 *      a leaked HMAC key.
 *   4. Mint a short-lived session token the kiosk uses for the follow-on
 *      punch mutation.
 *
 * Always logs an auth event — success or failure — so a spike of bad PINs
 * is visible in the audit trail without tailing logs.
 */
export async function kioskVerifyPin(
  device: KioskDeviceCtx,
  pin: string,
  ctx: { ip?: string | null; userAgent?: string | null },
): Promise<KioskEmployeeContext> {
  const lock = isDeviceLocked(device.id);
  if (lock.locked) {
    throw Unauthorized(`Too many bad PINs. Retry in ${Math.ceil(lock.retryAfterMs / 1000)}s`);
  }

  const fp = pinFingerprint(device.companyId, pin);
  const employee = await db('employees')
    .where({ company_id: device.companyId, pin_fingerprint: fp, status: 'active' })
    .first<{ id: number; first_name: string; last_name: string; pin_hash: string | null }>();

  if (!employee?.pin_hash || !(await verifyPin(pin, employee.pin_hash))) {
    const lockState = recordBadPin(device.id);
    await recordAuthEvent({
      eventType: 'login_failure',
      companyId: device.companyId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: {
        kiosk_device_id: device.id,
        reason: 'bad_pin',
        now_locked: lockState.locked,
      },
    });
    throw Unauthorized('Unrecognized PIN');
  }

  recordGoodPin(device.id);

  const sessionToken = jwt.sign(
    {
      sub: String(employee.id),
      typ: 'kiosk_employee',
      kioskDeviceId: device.id,
      companyId: device.companyId,
    } satisfies KioskEmployeeSessionClaims,
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: KIOSK_EMPLOYEE_SESSION_TTL_SECONDS },
  );

  // Look up current open entry + today's running total. Both tables are
  // added in Phase 5 — until then, these are "no open entry, 0 seconds".
  // Once Phase 5 lands, plug real queries here without changing the
  // response shape.
  const openEntry = null;
  const todayWorkSeconds = 0;

  await recordAuthEvent({
    eventType: 'login_success',
    companyId: device.companyId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    metadata: { kiosk_device_id: device.id, employee_id: employee.id },
  });

  return {
    employeeId: employee.id,
    firstName: employee.first_name,
    lastName: employee.last_name,
    sessionToken,
    openEntry,
    todayWorkSeconds,
  };
}

export function verifyKioskEmployeeSession(token: string): KioskEmployeeSessionClaims {
  try {
    const claims = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ['HS256'],
    }) as KioskEmployeeSessionClaims;
    if (claims.typ !== 'kiosk_employee') throw Unauthorized('Wrong token type');
    return claims;
  } catch {
    throw Unauthorized('Invalid or expired kiosk session');
  }
}

/** Compare kiosk tokens in constant time — trivial but keeps the intent
 *  explicit where it's used. */
export function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
