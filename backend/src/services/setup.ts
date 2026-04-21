import crypto from 'node:crypto';
import type { AuthResponse, SetupInitialRequest } from '@vibept/shared';
import type { Knex } from 'knex';
import { db } from '../db/knex.js';
import { Conflict } from '../http/errors.js';
import { recordAuthEvent } from './auth-events.js';
import { buildAuthUser } from './auth.js';
import { hashPassword } from './passwords.js';
import { issueAccessToken, issueRefreshToken } from './tokens.js';
import { anySuperAdminHasExisted, type UserRow } from './users.js';

interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Setup is considered complete when EITHER
 *   - `appliance_settings.installation_id` has been stamped (it is
 *     written as part of runInitialSetup and never reverted), OR
 *   - any SuperAdmin row has ever existed — including disabled ones.
 *
 * Both signals are checked so that mutating one out of band (a user
 * cleanup script that nulls `installation_id`, or an ops procedure
 * that disables the only SuperAdmin) does not reopen the setup wizard
 * to anyone on the network. See docs/security.md.
 */
async function isSetupComplete(q: Knex | Knex.Transaction = db): Promise<boolean> {
  const settings = await q('appliance_settings')
    .where({ id: 1 })
    .first<{ installation_id: string | null }>();
  const installationSet =
    !!settings?.installation_id && settings.installation_id !== 'pending-setup';
  if (installationSet) return true;
  return await anySuperAdminHasExisted(q as Knex.Transaction);
}

export async function getSetupStatus(): Promise<{
  setupRequired: boolean;
  installationId: string | null;
}> {
  const settings = await db('appliance_settings')
    .where({ id: 1 })
    .first<{ installation_id: string | null }>();
  const installationId =
    settings?.installation_id && settings.installation_id !== 'pending-setup'
      ? settings.installation_id
      : null;
  const complete = !!installationId || (await anySuperAdminHasExisted());
  return {
    setupRequired: !complete,
    installationId,
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
    // Gate on the strongest definition of "setup complete" — installation_id
    // stamped OR any super_admin row (active or disabled) has ever existed.
    // Using countSuperAdmins (which excludes disabled) would let a cleanup
    // script that disables the one SuperAdmin reopen this endpoint to
    // anyone on the network.
    if (await isSetupComplete(trx)) {
      throw Conflict('Appliance is already set up');
    }

    // Appliance settings: stamp a permanent installation_id. The WHERE
    // clause includes the `pending-setup` sentinel so even if two
    // concurrent requests slip past the isSetupComplete gate, only the
    // first one actually writes the row and the second silently no-ops
    // (and then fails on the unique email below anyway).
    const installationId = crypto.randomUUID();
    const updated = await trx('appliance_settings')
      .where({ id: 1, installation_id: 'pending-setup' })
      .update({
        installation_id: installationId,
        timezone_default: body.appliance.timezone,
        updated_at: trx.fn.now(),
      });
    if (updated === 0) {
      throw Conflict('Appliance is already set up');
    }

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
