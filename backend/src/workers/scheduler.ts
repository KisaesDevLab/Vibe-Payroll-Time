// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { logger } from '../config/logger.js';
import { QUEUE_NAMES, getQueues } from './queues.js';

// Cron expressions match the pre-Phase-14 node-cron schedules so the
// observable behavior is identical:
//   - auto-clockout:    every 5 minutes
//   - missed-punch:     every 5 minutes
//   - license-heartbeat: daily 04:17 UTC
//   - retention-sweep:   daily 03:41 UTC
const SCHEDULES = {
  [QUEUE_NAMES.autoClockout]: '*/5 * * * *',
  [QUEUE_NAMES.missedPunch]: '*/5 * * * *',
  [QUEUE_NAMES.licenseHeartbeat]: '17 4 * * *',
  [QUEUE_NAMES.retentionSweep]: '41 3 * * *',
} as const;

/**
 * Register the four repeatable jobs. Idempotent — BullMQ's
 * upsertJobScheduler dedupes by scheduler id so calling this on every
 * boot is safe.
 */
export async function scheduleRepeatableJobs(): Promise<void> {
  const queues = getQueues();
  for (const [queueName, cronPattern] of Object.entries(SCHEDULES)) {
    const queue = queues[queueName as keyof typeof queues];
    const schedulerId = `${queueName}:default`;
    await queue.upsertJobScheduler(
      schedulerId,
      { pattern: cronPattern },
      {
        name: queueName,
        data: {},
        opts: {
          // Job retention — keep the last 100 successes and 500
          // failures so the operator can debug recent issues without
          // letting Redis grow unbounded.
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 500 },
          attempts: 1,
        },
      },
    );
    logger.info({ queue: queueName, cron: cronPattern, schedulerId }, 'scheduled repeatable job');
  }
}

/**
 * Remove the four repeatable schedules. Used by the dev "reset queues"
 * tool and by tests; not called during graceful shutdown (the schedule
 * survives across restarts on purpose).
 */
export async function unscheduleRepeatableJobs(): Promise<void> {
  const queues = getQueues();
  for (const queueName of Object.keys(SCHEDULES)) {
    const queue = queues[queueName as keyof typeof queues];
    const schedulerId = `${queueName}:default`;
    await queue.removeJobScheduler(schedulerId).catch(() => undefined);
  }
}
