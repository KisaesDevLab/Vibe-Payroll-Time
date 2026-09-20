// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import crypto from 'node:crypto';
import {
  createPgStores,
  createVibeAuth,
  sendHttpResponse,
  toHttpRequest,
  type HttpResponse,
  type SessionAdapter,
  type SessionIdentity,
  type VibeAuth,
  type VibeUser,
} from '@kisaesdevlab/vibe-auth';
import type { Request, RequestHandler, Response } from 'express';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { parseAllowedOriginEntries } from '../../config/public-url.js';
import { db } from '../../db/knex.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import {
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  type AccessTokenClaims,
} from '../tokens.js';
import { healEmployeeLinksForUser, markLoginSuccess, type UserRow } from '../users.js';
import {
  VIBE_PT_ADMIN_ROLE,
  VIBE_PT_ROLE_MAP,
  VIBE_PT_ROLES,
  createVibeUsers,
  vibeAuditSink,
} from './users.js';

/**
 * Vibe Auth (single sign-on) — the product side of the contract.
 *
 * The package (@kisaesdevlab/vibe-auth) owns the OIDC flow, the Settings →
 * Authentication API and the break-glass rules. This module supplies:
 *
 *   - A SessionAdapter for a stateless-JWT product. There is no cookie
 *     session to create: an SSO login mints the same access + refresh pair
 *     POST /auth/login does (the access token additionally carries a `sid`
 *     claim) and hands both to the SPA on the FRAGMENT of the post-login
 *     redirect — `/login#sso_token=…&sso_refresh=…` — which never reaches a
 *     server or a log. The identity behind the session (issuer, subject,
 *     IdP session id, ID token) is parked in auth_sessions_oidc so logout
 *     and back-channel logout can find it.
 *   - Identity / settings / revocation stores on the package tables, the
 *     client secret wrapped with the appliance's AES-GCM key
 *     (services/crypto.ts), audit events into auth_events.
 *
 * Staff realm only. The kiosk realm (device token + PIN/badge) lives under
 * /api/v1/kiosk/* and this engine only ever claims /auth/*, so kiosk
 * pairing and punches are untouched in every mode.
 *
 * Paths. Every deployment strips the SPA prefix before the API sees a
 * request, so the engine routes on `/auth/*` with an empty basePath. The
 * browser-facing prefix (`/time` on the appliance) comes from the public
 * URL and is applied to the paths the engine hands the BROWSER.
 *
 * Only the engine's own paths may be routed to this tier — the SPA owns
 * `/auth/magic` and `/auth/reset`. See docs/sso.md § Routing.
 */

const AUTH_PREFIX = '/auth';

/**
 * The settings page opens the test-connection popup by plain navigation,
 * so no bearer header travels with it. POST /auth/settings/test (which the
 * page calls first, WITH the bearer) answers with this short-lived cookie
 * scoped to the OIDC paths; the session lookup accepts it for that one
 * navigation only.
 */
const SSO_ADMIN_COOKIE = 'vibept_sso_admin';
const SSO_ADMIN_COOKIE_TTL_SEC = 10 * 60;

function bearerFrom(req: Request): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : null;
}

function cookieFrom(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

function isTestStartNavigation(req: Request): boolean {
  return req.method === 'GET' && req.path === `${AUTH_PREFIX}/oidc/start` && req.query.test === '1';
}

async function sessionFor(req: Request): Promise<AccessTokenClaims | null> {
  const token =
    bearerFrom(req) ?? (isTestStartNavigation(req) ? cookieFrom(req, SSO_ADMIN_COOKIE) : null);
  if (!token) return null;
  try {
    const claims = verifyAccessToken(token);
    const revoked = await getVibeAuth().isRevoked({ userId: claims.sub }, (claims.iat ?? 0) * 1000);
    return revoked ? null : claims;
  } catch {
    return null;
  }
}

export interface SsoTokens {
  accessToken: string;
  refreshToken: string;
}

/** Mint the session an SSO login lands with — the same shape every other
 *  login mints, plus the `sid` that ties it to its identity row. */
async function mintSsoSession(
  user: VibeUser,
  identity: SessionIdentity,
  ctx: { ip: string | null; userAgent: string | null },
): Promise<SsoTokens> {
  const id = Number(user.id);
  // Re-read rather than trust `user.role`: role sync ran a moment ago, and
  // it may have been refused (last super_admin).
  const row = await db<UserRow>('users').where({ id }).whereNull('disabled_at').first();
  if (!row) throw new Error(`vibe-auth: user ${user.id} vanished during sign-in`);

  await healEmployeeLinksForUser(row.id, row.email);

  const sid = crypto.randomBytes(16).toString('hex');
  await db('auth_sessions_oidc').insert({
    sid,
    user_id: row.id,
    issuer: identity.issuer,
    subject: identity.subject,
    oidc_sid: identity.sid ?? null,
    id_token: identity.idToken ?? null,
  });

  const access = issueAccessToken(
    { id: row.id, email: row.email, roleGlobal: row.role_global },
    { authMethod: 'sso', sid },
  );
  const refresh = await issueRefreshToken({
    userId: row.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    ssoSid: sid,
  });
  await markLoginSuccess(row.id);

  // Identity rows are otherwise deleted only by logout or back-channel
  // logout, so a session that simply expired would leave its row behind
  // for ever. Each SSO login sweeps the rows no live refresh token points
  // at (the table is small; no scheduler needed). The hour of grace keeps
  // a concurrent sign-in's just-inserted row out of the sweep.
  await db('auth_sessions_oidc')
    .where('created_at', '<', new Date(Date.now() - 60 * 60 * 1000))
    .whereNotExists(
      db('refresh_tokens')
        .whereRaw('refresh_tokens.sso_sid = auth_sessions_oidc.sid')
        .whereNull('revoked_at')
        .where('expires_at', '>', db.fn.now())
        .select(db.raw('1')),
    )
    .delete();

  return { accessToken: access.token, refreshToken: refresh.token };
}

const sessions: SessionAdapter = {
  async create(req: Request, res: Response, user: VibeUser, identity: SessionIdentity) {
    // vibeAuthMiddleware() appends the pair to the engine's post-login redirect.
    res.locals.vibeAuthTokens = await mintSsoSession(user, identity, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  },

  /** The client discards its tokens; server-side we drop the identity row
   *  and the refresh chain that belongs to it. */
  async destroy(req: Request) {
    const s = await sessionFor(req);
    if (!s?.sid) return;
    await db('refresh_tokens')
      .where({ sso_sid: s.sid })
      .whereNull('revoked_at')
      .update({ revoked_at: db.fn.now() });
    await db('auth_sessions_oidc').where({ sid: s.sid }).delete();
  },

  async currentUserId(req: Request) {
    return (await sessionFor(req))?.sub ?? null;
  },

  async currentIdentity(req: Request) {
    const s = await sessionFor(req);
    if (!s?.sid) return null;
    const row = await db('auth_sessions_oidc').where({ sid: s.sid }).first<{
      issuer: string;
      subject: string;
      oidc_sid: string | null;
      id_token: string | null;
    }>();
    if (!row) return null;
    return {
      issuer: row.issuer,
      subject: row.subject,
      ...(row.oidc_sid ? { sid: row.oidc_sid } : {}),
      ...(row.id_token ? { idToken: row.id_token } : {}),
    };
  },

  /**
   * Back-channel logout. The package puts the user on the revocation list
   * right after this, which kills every outstanding ACCESS token on its
   * next request; here we end what would mint new ones. All of the user's
   * refresh tokens go, not just the SSO-born ones: the IdP saying "this
   * person is signed out" has to mean it, and under oidc_only a surviving
   * password-era refresh chain would otherwise live on for 30 days.
   */
  async destroyByIdentity(i) {
    const userId = i.userId !== undefined ? Number(i.userId) : NaN;
    const rows = await db('auth_sessions_oidc')
      .where((b) => {
        let any = false;
        if (i.sid) {
          b.orWhere({ oidc_sid: i.sid });
          any = true;
        }
        if (i.subject) {
          b.orWhere({ issuer: i.issuer, subject: i.subject });
          any = true;
        }
        if (Number.isInteger(userId)) {
          b.orWhere({ user_id: userId });
          any = true;
        }
        if (!any) b.whereRaw('false');
      })
      .delete()
      .returning<Array<{ user_id: number }>>('user_id');

    const userIds = new Set(rows.map((r) => r.user_id));
    if (Number.isInteger(userId)) userIds.add(userId);
    if (userIds.size > 0) {
      await db('refresh_tokens')
        .whereIn('user_id', [...userIds])
        .whereNull('revoked_at')
        .update({ revoked_at: db.fn.now() });
    }
    return rows.length;
  },
};

/**
 * The package's stores speak parameterised SQL with $1..$n placeholders.
 * knex.raw() insists on counting `?` bindings, so run them on a pooled pg
 * connection borrowed from knex instead.
 */
interface RawPgConnection {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}
async function pgQuery(
  sql: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const client = db.client as {
    acquireConnection(): Promise<RawPgConnection>;
    releaseConnection(c: RawPgConnection): Promise<void>;
  };
  const conn = await client.acquireConnection();
  try {
    return (await conn.query(sql, params)).rows;
  } finally {
    await client.releaseConnection(conn);
  }
}

/**
 * This product's public URL INCLUDING its path prefix. The console's
 * VIBE_OIDC_PUBLIC_URL wins when set (it is what the broker registered the
 * redirect URI from); otherwise PUBLIC_URL, otherwise the first literal
 * ALLOWED_ORIGIN — the same precedence outbound links already use. The
 * scheme is whatever those carry: a LAN appliance is plain http, and
 * nothing here may assume https.
 */
function resolvePublicUrl(): string | undefined {
  const fromConsole = process.env.VIBE_OIDC_PUBLIC_URL?.trim();
  const firstAllowed = parseAllowedOriginEntries(env.ALLOWED_ORIGIN).find(
    (e) => e.kind === 'literal',
  );
  const url = fromConsole || env.PUBLIC_URL || (firstAllowed?.value as string | undefined);
  return url?.replace(/\/+$/, '');
}

let instance: VibeAuth | null = null;
let spaPrefix = '';

/** Built on first use. Changing a URL-derived env value needs a restart. */
export function getVibeAuth(): VibeAuth {
  if (instance) return instance;

  const publicUrl = resolvePublicUrl();
  try {
    spaPrefix = publicUrl ? new URL(publicUrl).pathname.replace(/\/+$/, '') : '';
  } catch {
    spaPrefix = '';
  }

  const pgStores = createPgStores({ query: pgQuery });
  instance = createVibeAuth({
    product: {
      slug: 'vibe-payroll',
      name: 'Vibe Payroll & Time',
      roles: {
        roles: VIBE_PT_ROLES,
        adminRole: VIBE_PT_ADMIN_ROLE,
        defaultRoleMap: VIBE_PT_ROLE_MAP,
      },
    },
    users: createVibeUsers(),
    session: sessions,
    identities: pgStores.identities,
    settings: pgStores.settings,
    revocations: pgStores.revocations,
    secretWrap: {
      wrap: async (plaintext) => encryptSecret(plaintext),
      unwrap: async (wrapped) => decryptSecret(wrapped),
    },
    audit: vibeAuditSink,
    basePath: '',
    loginPath: `${spaPrefix}/login`,
    breakglassLoginPath: `${spaPrefix}/login/local`,
    // The SPA reads the tokens off the fragment wherever it lands, but
    // /login is the one route guaranteed to render without a session.
    defaultReturnTo: `${spaPrefix}/login`,
    ...(publicUrl ? { publicUrl } : {}),
    trustProxy: true,
    syncRoles: true,
    logger: {
      info: (msg, meta) => logger.info(meta ?? {}, msg),
      warn: (msg, meta) => logger.warn(meta ?? {}, msg),
      error: (msg, meta) => logger.error(meta ?? {}, msg),
    },
  });
  return instance;
}

/**
 * Boot: resolve config and begin IdP discovery. Throws only for the one
 * refusal the package makes at startup — oidc_only with no active
 * break-glass user — which server.ts lets abort the boot with the
 * package's own message. An unreachable IdP never throws.
 */
export async function startVibeAuth(): Promise<void> {
  const auth = getVibeAuth();
  await auth.start();
  const s = auth.status();
  logger.info(
    { mode: s.mode, sso: s.oidc.enabled ? s.oidc.issuer : 'off', prefix: spaPrefix || '/' },
    'vibe-auth started',
  );
}

export function stopVibeAuth(): void {
  instance?.stop();
}

/** For tests: drop the singleton so the next getVibeAuth() re-reads env. */
export function _resetVibeAuth(): void {
  instance?.stop();
  instance = null;
  spaPrefix = '';
}

/** The post-login hand-off: both tokens ride the redirect's fragment,
 *  replacing any fragment already there. Never a query string. */
export function withSsoTokens(location: string, tokens: SsoTokens): string {
  const fragment = new URLSearchParams({
    sso_token: tokens.accessToken,
    sso_refresh: tokens.refreshToken,
  });
  return `${location.split('#')[0]}#${fragment.toString()}`;
}

/**
 * Which /auth/* paths the auth rate limiter covers (app.ts): the
 * browser-driven OIDC steps and the admin test-connection popup. NOT the
 * back-channel logout — the identity provider posts those from ONE address
 * for every user — and not the status / me / settings reads.
 */
const RATE_LIMITED_AUTH_PATHS = new Set([
  `${AUTH_PREFIX}/oidc/start`,
  `${AUTH_PREFIX}/oidc/callback`,
  `${AUTH_PREFIX}/oidc/exchange`,
  `${AUTH_PREFIX}/settings/test`,
]);
export function isRateLimitedAuthPath(path: string): boolean {
  return RATE_LIMITED_AUTH_PATHS.has(path.replace(/\/+$/, ''));
}

function isJsonObject(body: unknown): body is Record<string, unknown> {
  return !!body && typeof body === 'object' && !Buffer.isBuffer(body) && !Array.isArray(body);
}

/** Prefix a path the engine built for the browser with the SPA prefix. */
function withPrefix(v: string): string {
  return v.startsWith(AUTH_PREFIX) ? spaPrefix + v : v;
}

function cookieIsSecure(req: Request): boolean {
  return env.COOKIE_SECURE === 'auto' ? req.secure : env.COOKIE_SECURE;
}

async function handleAuthRequest(req: Request, res: Response): Promise<boolean> {
  const auth = getVibeAuth();
  const r: HttpResponse | null = await auth.handle(toHttpRequest(req, res));
  if (!r) return false;

  // Post-login hand-off: the session adapter minted the pair.
  const tokens = res.locals.vibeAuthTokens as SsoTokens | undefined;
  if (tokens && r.status >= 300 && r.status < 400 && r.headers.location) {
    r.headers.location = withSsoTokens(r.headers.location, tokens);
  }

  // Test-connection popup: hand the admin's bearer to the OIDC start path
  // as a cookie, since the popup is a plain navigation (SSO_ADMIN_COOKIE).
  if (req.method === 'POST' && req.path === `${AUTH_PREFIX}/settings/test` && r.status === 200) {
    const bearer = bearerFrom(req);
    if (bearer) {
      res.cookie(SSO_ADMIN_COOKIE, bearer, {
        maxAge: SSO_ADMIN_COOKIE_TTL_SEC * 1000,
        httpOnly: true,
        secure: cookieIsSecure(req),
        sameSite: 'lax',
        path: `${spaPrefix}${AUTH_PREFIX}/oidc`,
      });
    }
  }

  // Browser-facing paths in JSON answers get the SPA prefix.
  if (spaPrefix && isJsonObject(r.body)) {
    if (typeof r.body.url === 'string') r.body.url = withPrefix(r.body.url);
    const oidc = r.body.oidc;
    if (isJsonObject(oidc) && typeof oidc.startPath === 'string') {
      oidc.startPath = withPrefix(oidc.startPath);
    }
  }

  // The engine's own pages (signed out, sign-in error, test result) carry
  // an inline style and, for the popup, an inline postMessage script. Give
  // them a CSP that permits exactly that, and let the popup keep
  // window.opener (helmet's COOP default would sever it).
  if ((r.headers['content-type'] ?? '').startsWith('text/html')) {
    r.headers['content-security-policy'] =
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
    res.removeHeader('Cross-Origin-Opener-Policy');
  }

  sendHttpResponse(res, r);
  return true;
}

/**
 * Express middleware for the engine's routes. Mount at app level after the
 * body parsers (the back-channel logout posts a form; app.ts already
 * parses urlencoded bodies globally); it passes every path outside /auth/*
 * straight through.
 */
export function vibeAuthMiddleware(): RequestHandler {
  return (req, res, next) => {
    if (req.path !== AUTH_PREFIX && !req.path.startsWith(`${AUTH_PREFIX}/`)) return next();
    handleAuthRequest(req, res)
      .then((handled) => {
        if (!handled) next();
      })
      .catch(next);
  };
}
