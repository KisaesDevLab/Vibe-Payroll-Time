import { FREE_CLIENT_COMPANY_CAP } from '@vibept/shared';
import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/knex.js';
import { loadRawToken } from './state.js';

/**
 * Daily license heartbeat. Phones the appliance-wide JWT back to the
 * portal so the portal can log the install and (optionally) return an
 * updated license with a new expiry. The cron is offline-tolerant — a
 * portal outage never blocks the appliance.
 *
 * Licensing is appliance-wide: one JWT per appliance, one heartbeat per
 * appliance, reporting the aggregate company count + non-internal
 * active-employee count.
 *
 * When LICENSE_PORTAL_HEARTBEAT_URL is unset, the cron is a no-op. This
 * is the default for pre-live appliances (matching LICENSING_ENFORCED
 * = false).
 */
export async function runLicenseHeartbeat(): Promise<number> {
  if (!env.LICENSE_PORTAL_HEARTBEAT_URL) return 0;

  const token = await loadRawToken();
  if (!token) return 0;

  try {
    // Bill only the client companies that fall OUTSIDE the free tier.
    // The first FREE_CLIENT_COMPANY_CAP non-internal companies (ranked
    // by created_at asc) are free — the portal shouldn't invoice for
    // them, so we exclude them from the heartbeat's aggregate counts.
    const freeIds = await db('companies')
      .whereNot('is_internal', true)
      .whereNull('disabled_at')
      .orderBy([
        { column: 'created_at', order: 'asc' },
        { column: 'id', order: 'asc' },
      ])
      .limit(FREE_CLIENT_COMPANY_CAP)
      .pluck<number[]>('id');

    const billableCompanies = db('companies')
      .whereNot('is_internal', true)
      .whereNotIn('id', freeIds.length > 0 ? freeIds : [0]);

    const companyCount = await billableCompanies
      .clone()
      .count<{ count: string }>({ count: '*' })
      .first();

    const employeeCount = await db('employees')
      .join('companies', 'employees.company_id', 'companies.id')
      .where('employees.status', 'active')
      .whereNot('companies.is_internal', true)
      .whereNotIn('companies.id', freeIds.length > 0 ? freeIds : [0])
      .whereNull('employees.terminated_at')
      .count<{ count: string }>({ count: '*' })
      .first();

    const res = await fetch(env.LICENSE_PORTAL_HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        applianceId: env.APPLIANCE_ID,
        companyCount: Number(companyCount?.count ?? 0),
        employeeCount: Number(employeeCount?.count ?? 0),
        freeTierCompanyCount: freeIds.length,
        license: token,
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'license heartbeat rejected');
      return 0;
    }

    await db('appliance_settings').where({ id: 1 }).update({
      last_license_check_at: db.fn.now(),
    });
    logger.info('license heartbeat complete');
    return 1;
  } catch (err) {
    logger.warn({ err }, 'license heartbeat failed');
    return 0;
  }
}

/** Schedule at a quiet hour (04:17 local); returns a stop function. */
export function scheduleLicenseHeartbeat(): () => void {
  if (!env.LICENSE_PORTAL_HEARTBEAT_URL) {
    logger.info('license heartbeat skipped (LICENSE_PORTAL_HEARTBEAT_URL unset)');
    return () => undefined;
  }
  const task = cron.schedule('17 4 * * *', () => {
    runLicenseHeartbeat().catch((err) => logger.error({ err }, 'license heartbeat threw'));
  });
  logger.info('license heartbeat scheduled (daily 04:17)');
  return () => task.stop();
}
