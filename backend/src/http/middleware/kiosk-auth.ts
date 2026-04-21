// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { NextFunction, Request, Response } from 'express';
import { resolveKioskToken } from '../../services/kiosk-pairing.js';
import { verifyKioskEmployeeSession } from '../../services/kiosk-verify.js';
import { Unauthorized } from '../errors.js';

export interface KioskDeviceContext {
  id: number;
  companyId: number;
  name: string;
}

export interface KioskEmployeeContext {
  employeeId: number;
  kioskDeviceId: number;
  companyId: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    kioskDevice?: KioskDeviceContext;
    kioskEmployee?: KioskEmployeeContext;
  }
}

/**
 * Authenticates a tablet via `X-Kiosk-Device-Token`. Populates
 * `req.kioskDevice` with the resolved device row. A kiosk device token
 * can ONLY reach endpoints mounted behind this middleware — admin routes
 * use `requireAuth` which checks a JWT bearer token in a different header,
 * so a kiosk token can never escalate.
 */
export async function requireKioskDevice(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = req.headers['x-kiosk-device-token'];
    if (typeof token !== 'string' || token.length < 32) {
      return next(Unauthorized('Missing kiosk device token'));
    }
    const resolved = await resolveKioskToken(token);
    if (!resolved) return next(Unauthorized('Invalid or revoked kiosk device'));
    req.kioskDevice = resolved;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Two layers for kiosk punch calls:
 *   1. The device is paired (requireKioskDevice above).
 *   2. An employee's PIN-verified session is active on this device
 *      (this middleware). The employee session token is minted by
 *      /kiosk/verify-pin and lives ~5 min.
 */
export function requireKioskEmployee(req: Request, _res: Response, next: NextFunction): void {
  try {
    const token = req.headers['x-kiosk-employee-session'];
    if (typeof token !== 'string' || token.length < 32) {
      return next(Unauthorized('Missing kiosk employee session'));
    }
    const claims = verifyKioskEmployeeSession(token);
    // Sanity: the device claim must match the device that authenticated
    // the request at layer 1. Prevents replay across devices.
    if (!req.kioskDevice || claims.kioskDeviceId !== req.kioskDevice.id) {
      return next(Unauthorized('Session does not belong to this device'));
    }
    req.kioskEmployee = {
      employeeId: Number(claims.sub),
      kioskDeviceId: claims.kioskDeviceId,
      companyId: claims.companyId,
    };
    next();
  } catch (err) {
    next(err);
  }
}
