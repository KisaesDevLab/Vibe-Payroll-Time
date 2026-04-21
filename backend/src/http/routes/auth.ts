import {
  loginRequestSchema,
  logoutRequestSchema,
  magicLinkConsumeRequestSchema,
  magicLinkRequestSchema,
  refreshRequestSchema,
} from '@vibept/shared';
import { Router } from 'express';
import { recordAuthEvent } from '../../services/auth-events.js';
import { buildAuthUser, loginWithPassword } from '../../services/auth.js';
import {
  consumeMagicLink,
  getMagicLinkOptions,
  requestMagicLink,
} from '../../services/magic-links.js';
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

// ---------------------------------------------------------------------------
// Magic link (passwordless) login
// ---------------------------------------------------------------------------

/** Public. LoginPage reads this before rendering so it can show/hide
 *  the email + SMS buttons based on what the appliance has configured. */
authRouter.get('/magic/options', async (_req, res, next) => {
  try {
    const data = await getMagicLinkOptions();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/** Request a magic link. Rate-limited (both here at the HTTP layer and
 *  again per-identifier inside the service). Always 204 on the happy
 *  path — we never reveal whether the identifier matched. */
authRouter.post('/magic/request', authRateLimiter, async (req, res, next) => {
  try {
    const body = magicLinkRequestSchema.parse(req.body);
    const origin = `${req.protocol}://${req.get('host') ?? ''}`;
    await requestMagicLink({
      identifier: body.identifier,
      channel: body.channel,
      origin,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/** Consume a token. Called by the /auth/magic frontend page with the
 *  ?token=... it pulled out of the URL. Returns the standard
 *  AuthResponse — same shape as /auth/login — so the frontend can
 *  store the session through the existing authStore. */
authRouter.post('/magic/consume', authRateLimiter, async (req, res, next) => {
  try {
    const body = magicLinkConsumeRequestSchema.parse(req.body);
    const session = await consumeMagicLink({
      token: body.token,
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.json({ data: session });
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
