import { db } from './knex.js';
import { logger } from '../config/logger.js';

export async function runMigrations(): Promise<void> {
  const start = Date.now();
  const [batch, applied] = (await db.migrate.latest()) as [number, string[]];
  const elapsed = Date.now() - start;

  if (applied.length === 0) {
    logger.info({ elapsed }, 'no pending migrations');
    return;
  }

  logger.info({ batch, applied, elapsed }, `applied ${applied.length} migration(s)`);
}

export async function getMigrationStatus(): Promise<{
  current: string | null;
  pending: string[];
}> {
  const [completed, pending] = (await db.migrate.list()) as [
    Array<{ name: string } | string>,
    Array<{ file: string } | string>,
  ];

  const last = completed[completed.length - 1];
  const current = last ? (typeof last === 'string' ? last : last.name) : null;
  const pendingNames = pending.map((p) => (typeof p === 'string' ? p : p.file));

  return { current, pending: pendingNames };
}
