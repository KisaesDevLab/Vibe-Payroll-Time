import { loginRequestSchema, logoutRequestSchema, refreshRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import { recordAuthEvent } from '../../services/auth-events.js';
import { buildAuthUser, loginWithPassword } from '../../services/auth.js';
import {
  issueAccessToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../../services/tokens.js';
import { findUserById } from '../../services/users.js';
import { NotFound } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rate-limit.js';

export const authRouter: Router = Router();

authRouter.post('/login', authRateLimiter, async (req, res, next) => {
  try {
    const body = loginRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const session = await loginWithPassword(body, ctx);
    res.json({ data: session });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', authRateLimiter, async (req, res, next) => {
  try {
    const body = refreshRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const rotated = await rotateRefreshToken(body.refreshToken, ctx);

    const user = await findUserById(rotated.userId);
    if (!user) throw NotFound('User no longer exists');

    const access = issueAccessToken({
      id: user.id,
      email: user.email,
      roleGlobal: user.role_global,
    });

    await recordAuthEvent({
      eventType: 'refresh',
      userId: user.id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    res.json({
      data: {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt.toISOString(),
        refreshToken: rotated.token,
        user: await buildAuthUser(user),
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', authRateLimiter, requireAuth, async (req, res, next) => {
  try {
    const body = logoutRequestSchema.parse(req.body ?? {});
    if (body.refreshToken) {
      await revokeRefreshToken(body.refreshToken);
    } else if (req.user) {
      await revokeAllForUser(req.user.id);
    }

    await recordAuthEvent({
      eventType: 'logout',
      userId: req.user?.id ?? null,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });

    res.json({ data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(NotFound('No user in context'));
    const user = await findUserById(req.user.id);
    if (!user) return next(NotFound('User not found'));
    res.json({ data: await buildAuthUser(user) });
  } catch (err) {
    next(err);
  }
});
