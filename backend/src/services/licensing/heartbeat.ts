import cron from 'node-cron';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { db } from '../../db/knex.js';
import { loadRawToken } from './state.js';

/**
 * Daily license heartbeat. Phones each licensed company's JWT back to
 * the portal so the portal can log the install and (optionally) return
 * an updated license with a new expiry. The cron is offline-tolerant —
 * a portal outage never blocks the appliance.
 *
 * When LICENSE_PORTAL_HEARTBEAT_URL is unset, the cron is a no-op. This
 * is the default for pre-live appliances (matching LICENSING_ENFORCED
 * = false).
 */
export async function runLicenseHeartbeat(): Promise<number> {
  if (!env.LICENSE_PORTAL_HEARTBEAT_URL) return 0;

  const companies = await db('companies')
    .whereNotNull('license_key_encrypted')
    .whereNot('is_internal', true)
    .select<Array<{ id: number; slug: string }>>('id', 'slug');

  let beats = 0;
  for (const c of companies) {
    const token = await loadRawToken(c.id);
    if (!token) continue;

    try {
      const employeeCount = await db('employees')
        .where({ company_id: c.id, status: 'active' })
        .count<{ count: string }>({ count: '*' })
        .first();

      const res = await fetch(env.LICENSE_PORTAL_HEARTBEAT_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          applianceId: env.APPLIANCE_ID,
          companyId: c.id,
          companySlug: c.slug,
          employeeCount: Number(employeeCount?.count ?? 0),
          license: token,
        }),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, company_id: c.id }, 'license heartbeat rejected');
        continue;
      }

      await db('companies').where({ id: c.id }).update({ last_license_check_at: db.fn.now() });
      beats += 1;
    } catch (err) {
      logger.warn({ err, company_id: c.id }, 'license heartbeat failed');
    }
  }

  if (beats > 0) logger.info({ beats }, 'license heartbeat complete');
  return beats;
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
