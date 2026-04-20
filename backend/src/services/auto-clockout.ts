import cron from 'node-cron';
import { logger } from '../config/logger.js';
import { db } from '../db/knex.js';
import type { TimeEntryRow } from './punch.js';

/**
 * Scan for open time_entries that have been running longer than the
 * company's `auto_clockout_hours` setting and close them. Writes an
 * `auto_close` audit row per closure.
 *
 * Runs every 5 minutes. Single-process safe because node-cron serializes
 * per-schedule within the process. In a multi-process future, move the
 * scanning query behind a `pg_try_advisory_lock` to prevent concurrent
 * runs across instances.
 */
export async function runAutoClockoutSweep(): Promise<number> {
  const start = Date.now();
  // Find candidates at read time — do not trust NOW() inside the update to
  // avoid racing an in-progress human punch that may be about to close
  // the same row.
  const candidates = await db('time_entries as t')
    .join('company_settings as s', 's.company_id', 't.company_id')
    .whereNull('t.ended_at')
    .whereNull('t.deleted_at')
    .whereRaw(`t.started_at < now() - (s.auto_clockout_hours || ' hours')::interval`)
    .select<
      Array<
        Pick<
          TimeEntryRow,
          'id' | 'company_id' | 'employee_id' | 'started_at' | 'entry_type'
        > & { auto_clockout_hours: number }
      >
    >(
      't.id',
      't.company_id',
      't.employee_id',
      't.started_at',
      't.entry_type',
      's.auto_clockout_hours',
    );

  if (candidates.length === 0) return 0;

  let closed = 0;
  for (const c of candidates) {
    try {
      await db.transaction(async (trx) => {
        await trx.raw('SELECT pg_advisory_xact_lock(?)', [c.employee_id]);

        // Re-check after lock; a real punch may have closed it first.
        const current = await trx<TimeEntryRow>('time_entries')
          .where({ id: c.id })
          .whereNull('ended_at')
          .whereNull('deleted_at')
          .first();
        if (!current) return;

        // Close at started_at + auto_clockout_hours rather than now(). This
        // gives a defensible "shift ended at 12 hours" interval instead of
        // "shift ended whenever the cron happened to run."
        const endedAt = new Date(
          current.started_at.getTime() + c.auto_clockout_hours * 3_600_000,
        );
        const duration = Math.floor(
          (endedAt.getTime() - current.started_at.getTime()) / 1000,
        );

        await trx('time_entries').where({ id: current.id }).update({
          ended_at: endedAt,
          duration_seconds: duration,
          is_auto_closed: true,
          updated_at: trx.fn.now(),
        });

        await trx('time_entry_audit').insert({
          time_entry_id: current.id,
          company_id: current.company_id,
          actor_user_id: null,
          action: 'auto_close',
          new_value: JSON.stringify({
            endedAt: endedAt.toISOString(),
            autoClockoutHours: c.auto_clockout_hours,
          }),
        });

        closed += 1;
      });
    } catch (err) {
      logger.error({ err, entry_id: c.id }, 'auto-clockout failed for entry');
    }
  }

  logger.info(
    { scanned: candidates.length, closed, elapsed: Date.now() - start },
    'auto-clockout sweep complete',
  );
  return closed;
}

/** Schedule the sweep on a 5-minute cadence. Call once at boot. */
export function scheduleAutoClockout(): () => void {
  const task = cron.schedule('*/5 * * * *', () => {
    runAutoClockoutSweep().catch((err) =>
      logger.error({ err }, 'auto-clockout sweep threw'),
    );
  });
  logger.info('auto-clockout sweep scheduled (every 5 minutes)');
  return () => task.stop();
}
