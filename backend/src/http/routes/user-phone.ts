import { confirmUserPhoneRequestSchema, setUserPhoneRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import { db } from '../../db/knex.js';
import { getResolvedSmsProvider } from '../../services/appliance-settings.js';
import {
  confirmUserPhoneVerification,
  requestUserPhoneVerification,
  setUserPhone,
} from '../../services/user-phone.js';
import { Unauthorized } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rate-limit.js';

export const userPhoneRouter: Router = Router();

/**
 * GET /me/phone — current state: number, verified flag, whether
 * appliance SMS is available, and whether a challenge is in flight.
 */
userPhoneRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const row = await db('users').where({ id: req.user.id }).first<{
      phone: string | null;
      phone_verified_at: Date | null;
      phone_verify_expires_at: Date | null;
    }>();
    const resolved = await getResolvedSmsProvider();
    const smsAvailable =
      (resolved.provider === 'twilio' && !!resolved.twilio) ||
      (resolved.provider === 'textlinksms' && !!resolved.textlinksms);
    const pendingExpires =
      row?.phone_verify_expires_at && row.phone_verify_expires_at.getTime() > Date.now()
        ? row.phone_verify_expires_at.toISOString()
        : null;
    res.json({
      data: {
        phone: row?.phone ?? null,
        phoneVerified: !!row?.phone_verified_at,
        smsAvailable,
        pendingCodeExpiresAt: pendingExpires,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** POST /me/phone — set or update the stored number. Does NOT send a
 *  code; caller asks for one separately. Send `phone: null` to clear. */
userPhoneRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = setUserPhoneRequestSchema.parse(req.body);
    await setUserPhone(req.user.id, body.phone);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** POST /me/phone/verify-request — send a 6-digit code to the current
 *  stored number via appliance-level SMS. Rate-limited. */
userPhoneRouter.post('/verify-request', authRateLimiter, requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const result = await requestUserPhoneVerification(req.user.id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /me/phone/verify-confirm — submit the 6-digit code. */
userPhoneRouter.post('/verify-confirm', authRateLimiter, requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = confirmUserPhoneRequestSchema.parse(req.body);
    await confirmUserPhoneVerification(req.user.id, body.code);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
