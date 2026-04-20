import { db } from './knex.js';
import { logger } from '../config/logger.js';

interface WaitOptions {
  /** Total attempts before giving up. */
  attempts?: number;
  /** Delay between attempts, in ms. */
  delayMs?: number;
}

/**
 * Wait for Postgres to accept connections. Necessary on appliance boot where
 * the backend container can start before Postgres is ready to serve `select
 * 1`, even with a docker-compose `depends_on.condition: service_healthy`.
 */
export async function waitForDb(opts: WaitOptions = {}): Promise<void> {
  const attempts = opts.attempts ?? 30;
  const delayMs = opts.delayMs ?? 1000;

  for (let i = 1; i <= attempts; i++) {
    try {
      await db.raw('select 1');
      if (i > 1) logger.info({ attempt: i }, 'database ready');
      return;
    } catch (err) {
      if (i === attempts) {
        logger.error({ err, attempts }, 'database never became ready');
        throw err;
      }
      logger.warn({ attempt: i, delayMs }, 'database not ready, retrying');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
