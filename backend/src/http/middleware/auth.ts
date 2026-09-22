// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { CompanyRole } from '@vibept/shared';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../db/knex.js';
import {
  verifyAccessToken,
  type AccessTokenClaims,
  type AuthMethod,
} from '../../services/tokens.js';
import { Forbidden, Unauthorized } from '../errors.js';

export interface AuthenticatedUser {
  id: number;
  email: string;
  roleGlobal: 'super_admin' | 'none';
  /** How this session was minted — `password` for the default login
   *  flow, `magic_link` for passwordless sign-ins. Read by endpoints
   *  that tighten or loosen requirements based on factor strength. */
  authMethod: AuthMethod;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Single sign-on revocation (Vibe Auth, D16). Access tokens are stateless,
 * so an identity-provider back-channel logout cannot delete a session — it
 * records "every token this user was issued up to NOW is dead" and this
 * check honours it. One primary-key read per authenticated request; a
 * fresh login (issued after the revocation moment) stays valid.
 *
 * Reached through a setter rather than an import so this middleware — and
 * every test that mounts it — does not drag in the SSO engine. app.ts wires
 * the real check; unset, nothing is ever revoked.
 */
export type RevocationCheck = (key: { userId: string }, issuedAtMs: number) => Promise<boolean>;
let revocationCheck: RevocationCheck | null = null;
export function setRevocationCheck(check: RevocationCheck | null): void {
  revocationCheck = check;
}

/**
 * Extract + verify the bearer token. Populates `req.user` with the verified
 * claims. Emits 401 for missing/invalid/expired/revoked tokens. Does NOT
 * check role — pair with requireSuperAdmin / requireCompanyRole for scoping.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(Unauthorized('Missing bearer token'));
  }

  let claims: AccessTokenClaims;
  try {
    claims = verifyAccessToken(header.slice('Bearer '.length).trim());
    if (await revocationCheck?.({ userId: claims.sub }, (claims.iat ?? 0) * 1000)) {
      return next(Unauthorized('Session has been signed out'));
    }
  } catch (err) {
    return next(err);
  }
  req.user = {
    id: Number(claims.sub),
    email: claims.email,
    roleGlobal: claims.roleGlobal,
    // Old tokens (pre-authMethod) default to 'password' so existing
    // sessions don't silently gain the magic-link set-password
    // privilege during a rolling upgrade.
    authMethod: claims.authMethod ?? 'password',
  };
  next();
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(Unauthorized());
  if (req.user.roleGlobal !== 'super_admin') return next(Forbidden('Super admin required'));
  next();
}

/**
 * Scope a handler to users who hold the required role within a given
 * company. `companyId` resolves from the `companyId` URL param (or
 * `req.params.company_id`, or a custom accessor).
 *
 * Always checks in the DB — never trusts JWT claims for company membership,
 * since memberships can change without re-issuing a token.
 */
export function requireCompanyRole(
  required: CompanyRole | CompanyRole[],
  opts: { companyIdFrom?: (req: Request) => number | undefined } = {},
) {
  const allowed = new Set(Array.isArray(required) ? required : [required]);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(Unauthorized());

      const raw =
        opts.companyIdFrom?.(req) ?? Number(req.params.companyId ?? req.params.company_id);

      if (!Number.isFinite(raw) || raw <= 0) {
        return next(Forbidden('Company context required'));
      }

      // Super admins bypass per-company role checks.
      if (req.user.roleGlobal === 'super_admin') return next();

      const membership = await db('company_memberships')
        .where({ user_id: req.user.id, company_id: raw })
        .first<{ role: CompanyRole }>();

      if (!membership) return next(Forbidden('Not a member of this company'));
      if (!allowed.has(membership.role)) return next(Forbidden('Insufficient role'));

      next();
    } catch (err) {
      next(err);
    }
  };
}
