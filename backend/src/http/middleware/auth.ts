import type { CompanyRole } from '@vibept/shared';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../../db/knex.js';
import { verifyAccessToken } from '../../services/tokens.js';
import { Forbidden, Unauthorized } from '../errors.js';

export interface AuthenticatedUser {
  id: number;
  email: string;
  roleGlobal: 'super_admin' | 'none';
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthenticatedUser;
  }
}

/**
 * Extract + verify the bearer token. Populates `req.user` with the verified
 * claims. Emits 401 for missing/invalid/expired tokens. Does NOT check
 * role — pair with requireSuperAdmin / requireCompanyRole for scoping.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(Unauthorized('Missing bearer token'));
  }

  const claims = verifyAccessToken(header.slice('Bearer '.length).trim());
  req.user = {
    id: Number(claims.sub),
    email: claims.email,
    roleGlobal: claims.roleGlobal,
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
