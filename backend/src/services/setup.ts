import crypto from 'node:crypto';
import type { AuthResponse, SetupInitialRequest } from '@vibept/shared';
import { db } from '../db/knex.js';
import { Conflict } from '../http/errors.js';
import { recordAuthEvent } from './auth-events.js';
import { buildAuthUser } from './auth.js';
import { hashPassword } from './passwords.js';
import { issueAccessToken, issueRefreshToken } from './tokens.js';
import { countSuperAdmins, type UserRow } from './users.js';

interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export async function getSetupStatus(): Promise<{
  setupRequired: boolean;
  installationId: string | null;
}> {
  const superAdmins = await countSuperAdmins();
  const settings = await db('appliance_settings')
    .where({ id: 1 })
    .first<{ installation_id: string }>();

  return {
    setupRequired: superAdmins === 0,
    installationId:
      settings?.installation_id === 'pending-setup' ? null : (settings?.installation_id ?? null),
  };
}

/**
 * First-run setup. Creates the SuperAdmin, the initial firm-internal
 * company, a `company_admin` membership linking them, and stamps the
 * appliance's permanent installation_id — all in a single transaction.
 *
 * Idempotency: this endpoint refuses (409 Conflict) once any SuperAdmin
 * exists, so reinvocation after the wizard completes cannot elevate a user.
 */
export async function runInitialSetup(
  body: SetupInitialRequest,
  ctx: RequestContext,
): Promise<AuthResponse> {
  return db.transaction(async (trx) => {
    const existing = await countSuperAdmins(trx);
    if (existing > 0) {
      throw Conflict('Appliance is already set up');
    }

    // Appliance settings: stamp a permanent installation_id.
    const installationId = crypto.randomUUID();
    await trx('appliance_settings').where({ id: 1 }).update({
      installation_id: installationId,
      timezone_default: body.appliance.timezone,
      updated_at: trx.fn.now(),
    });

    // Create the SuperAdmin.
    const passwordHash = await hashPassword(body.admin.password);
    const [userRow] = await trx('users')
      .insert({
        email: body.admin.email,
        password_hash: passwordHash,
        role_global: 'super_admin',
      })
      .returning<UserRow[]>('*');

    if (!userRow) throw new Error('failed to create super admin');

    // Create the firm-internal company and its default settings row.
    const [companyRow] = await trx('companies')
      .insert({
        name: body.company.name,
        slug: body.company.slug,
        timezone: body.company.timezone,
        week_start_day: body.company.weekStartDay,
        pay_period_type: body.company.payPeriodType,
        is_internal: true,
        license_state: 'internal_free',
      })
      .returning<Array<{ id: number }>>('id');

    if (!companyRow) throw new Error('failed to create company');

    // Internal firms default to self-approve.
    await trx('company_settings').insert({
      company_id: companyRow.id,
      allow_self_approve: true,
    });

    // Link SuperAdmin to the firm company as a company_admin.
    await trx('company_memberships').insert({
      user_id: userRow.id,
      company_id: companyRow.id,
      role: 'company_admin',
    });

    await recordAuthEvent(
      {
        eventType: 'setup_initial',
        userId: userRow.id,
        companyId: companyRow.id,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { installationId },
      },
      trx,
    );

    // Mint an initial session so the wizard can redirect into the app.
    const access = issueAccessToken({
      id: userRow.id,
      email: userRow.email,
      roleGlobal: userRow.role_global,
    });
    const refresh = await issueRefreshToken(
      { userId: userRow.id, ip: ctx.ip, userAgent: ctx.userAgent },
      trx,
    );

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      user: await buildAuthUser(userRow),
    };
  });
}
