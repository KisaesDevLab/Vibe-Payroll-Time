// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
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
  // Files live at EXPORTS_DIR/<companyId>/<fileName> — see
  // payroll-exports/engine.ts which calls
  // `path.resolve(env.EXPORTS_DIR, String(companyId))` then writes
  // `<format>-<periodStart>-<hash>.csv` into it. A flat `readdir` of
  // EXPORTS_DIR sees only the company subdirectories, which `isFile()`
  // rejects — so before this walked the company subdirs nothing was
  // ever pruned and disk grew unbounded. Walk one level deep with
  // `withFileTypes: true` so we visit each company dir's contents.
  const root = path.resolve(env.EXPORTS_DIR);
  let removed = 0;
  try {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(root, entry.name);
      if (entry.isFile()) {
        // Legacy flat layout: prune in place.
        const stat = await fs.stat(full).catch(() => null);
        if (stat && stat.mtime < cutoffDate) {
          await fs.unlink(full);
          removed += 1;
        }
        continue;
      }
      if (!entry.isDirectory()) continue;
      const subEntries = await fs.readdir(full, { withFileTypes: true }).catch(() => []);
      for (const sub of subEntries) {
        if (!sub.isFile()) continue;
        const subFull = path.join(full, sub.name);
        const stat = await fs.stat(subFull).catch(() => null);
        if (stat && stat.mtime < cutoffDate) {
          await fs.unlink(subFull);
          removed += 1;
        }
      }
    }
    if (removed > 0) logger.info({ root, removed }, 'retention: export files pruned');
  } catch (err) {
    logger.error({ err, root }, 'retention: export file prune failed');
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
