import cron from 'node-cron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { db } from '../db/knex.js';

/**
 * Data-retention sweeper. Runs nightly at 03:41 UTC and prunes rows +
 * on-disk artifacts that age past their retention window.
 *
 * Retention windows (all set generously; CPAs want long trails):
 *   - auth_events:          365 days
 *   - notifications_log:    180 days
 *   - ai_correction_usage:   90 days
 *   - payroll_exports file: 365 days (DB row kept longer)
 *   - kiosk_pairing_codes:   30 days (they expire in minutes, this is just sweep)
 *
 * Not pruned by this job:
 *   - time_entries + time_entry_audit — permanent, by design
 *   - refresh_tokens — pruned at verification time
 *   - employees / jobs / companies — only soft-deleted, never hard-deleted here
 */

const RETENTION = {
  authEventsDays: 365,
  notificationsLogDays: 180,
  aiCorrectionUsageDays: 90,
  payrollExportFileDays: 365,
  kioskPairingCodesDays: 30,
};

async function pruneRows(table: string, cutoffDate: Date, column = 'created_at'): Promise<number> {
  try {
    const deleted = await db(table).where(column, '<', cutoffDate).del();
    if (deleted > 0) logger.info({ table, deleted }, 'retention: rows pruned');
    return deleted;
  } catch (err) {
    logger.error({ err, table }, 'retention: prune failed');
    return 0;
  }
}

async function pruneExportFiles(cutoffDate: Date): Promise<number> {
  const dir = path.resolve(env.EXPORTS_DIR);
  let removed = 0;
  try {
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of files) {
      const full = path.join(dir, name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isFile()) continue;
      if (stat.mtime < cutoffDate) {
        await fs.unlink(full);
        removed += 1;
      }
    }
    if (removed > 0) logger.info({ dir, removed }, 'retention: export files pruned');
  } catch (err) {
    logger.error({ err, dir }, 'retention: export file prune failed');
  }
  return removed;
}

export async function runRetentionSweep(): Promise<void> {
  const start = Date.now();
  const now = Date.now();
  const since = (days: number) => new Date(now - days * 24 * 3600 * 1000);

  await pruneRows('auth_events', since(RETENTION.authEventsDays));
  await pruneRows('notifications_log', since(RETENTION.notificationsLogDays));
  await pruneRows('ai_correction_usage', since(RETENTION.aiCorrectionUsageDays));
  await pruneRows('kiosk_pairing_codes', since(RETENTION.kioskPairingCodesDays));
  await pruneExportFiles(since(RETENTION.payrollExportFileDays));

  logger.info({ elapsed: Date.now() - start }, 'retention sweep complete');
}

export function scheduleRetentionSweep(): () => void {
  const task = cron.schedule('41 3 * * *', () => {
    runRetentionSweep().catch((err) => logger.error({ err }, 'retention sweep threw'));
  });
  logger.info('retention sweep scheduled (03:41 UTC daily)');
  return () => task.stop();
}
