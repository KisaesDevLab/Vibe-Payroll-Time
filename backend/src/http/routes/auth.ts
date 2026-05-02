// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  magicLinkConsumeRequestSchema,
  magicLinkRequestSchema,
  refreshRequestSchema,
  setPasswordAfterMagicLinkRequestSchema,
} from '@vibept/shared';
import { Router } from 'express';
import { recordAuthEvent } from '../../services/auth-events.js';
import {
  buildAuthUser,
  changePassword,
  loginWithPassword,
  setPasswordAfterMagicLink,
} from '../../services/auth.js';
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
import { findUserById, healEmployeeLinksForUser } from '../../services/users.js';
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

    // Self-heal link between this user and any employees rows with a
    // matching email but no user_id. Same helper as /auth/login and
    // /auth/magic/consume — runs BEFORE buildAuthUser so the
    // refreshed memberships payload reflects a newly-linked row on
    // this very refresh. A client that logged in before the link was
    // established no longer needs an explicit sign-out → sign-in to
    // pick up the fix; the next 15-minute refresh tick heals them.
    await healEmployeeLinksForUser(user.id, user.email);

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
    // Prefer PUBLIC_URL when set — that's the canonical operator-chosen
    // origin for outbound links and is what we want appearing in magic
    // links regardless of which internal hop processed the request.
    // Otherwise prefer the client-supplied origin (window.location.origin)
    // when it matches the ALLOWED_ORIGIN allowlist; failing that, fall
    // back to the request's own host. An attacker can't redirect the
    // link by supplying a bogus origin because we verify against the
    // ALLOWED_ORIGIN env whitelist.
    const { env } = await import('../../config/env.js');
    const { resolvePublicOrigin } = await import('../../config/public-url.js');
    const hostOrigin = `${req.protocol}://${req.get('host') ?? ''}`;
    const origin = resolvePublicOrigin({
      publicUrl: env.PUBLIC_URL,
      allowedOrigin: env.ALLOWED_ORIGIN,
      clientOrigin: body.origin,
      requestOrigin: hostOrigin,
    });
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

// Change password for the signed-in user. Rate-limited like the rest
// of the /auth/* endpoints so a compromised access token can't brute
// the current password by spamming this endpoint.
authRouter.post('/change-password', authRateLimiter, requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(NotFound('No user in context'));
    const body = changePasswordRequestSchema.parse(req.body);
    await changePassword(req.user.id, body.currentPassword, body.newPassword, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Set a new password without requiring the current one. Only allowed
// when the calling session was minted via magic-link — the magic-link
// was the ownership proof within the last 15 minutes. A password-only
// session that tried this would be trivially takeover-able by anyone
// with a stolen access token.
authRouter.post('/set-password', authRateLimiter, requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(NotFound('No user in context'));
    if (req.user.authMethod !== 'magic_link') {
      return next(
        new (await import('../errors.js')).HttpError(
          403,
          'wrong_auth_method',
          'Set-password without current-password requires a magic-link session. Sign out and click "Email me a login link" instead.',
        ),
      );
    }
    const body = setPasswordAfterMagicLinkRequestSchema.parse(req.body);
    await setPasswordAfterMagicLink(req.user.id, body.newPassword, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
