import {
  kioskVerifyPinRequestSchema,
  pairKioskRequestSchema,
} from '@vibept/shared';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { pairKiosk } from '../../services/kiosk-pairing.js';
import { kioskVerifyPin } from '../../services/kiosk-verify.js';
import { Unauthorized } from '../errors.js';
import { requireKioskDevice } from '../middleware/kiosk-auth.js';

export const kioskRouter: Router = Router();

// Pairing is public (no auth) — the one-time code IS the auth factor.
// Rate-limit to deter online brute-force of the 8-digit code.
const pairLimiter = rateLimit({
  windowMs: 60_000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many pairing attempts. Please retry shortly.',
    },
  },
});

kioskRouter.post('/pair', pairLimiter, async (req, res, next) => {
  try {
    const body = pairKioskRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const result = await pairKiosk(body, ctx);
    res.status(201).json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Device-authenticated endpoints — header `X-Kiosk-Device-Token`.
kioskRouter.get('/me', requireKioskDevice, async (req, res, next) => {
  try {
    if (!req.kioskDevice) return next(Unauthorized());
    res.json({
      data: {
        id: req.kioskDevice.id,
        companyId: req.kioskDevice.companyId,
        name: req.kioskDevice.name,
      },
    });
  } catch (err) {
    next(err);
  }
});

kioskRouter.post('/verify-pin', requireKioskDevice, async (req, res, next) => {
  try {
    if (!req.kioskDevice) return next(Unauthorized());
    const body = kioskVerifyPinRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const result = await kioskVerifyPin(req.kioskDevice, body.pin, ctx);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});
