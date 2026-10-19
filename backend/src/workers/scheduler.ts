// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAMES, QUEUE_PREFIX, getQueues } from './queues.js';

// Cron expressions match the pre-Phase-14 node-cron schedules so the
// observable behavior is identical:
//   - auto-clockout:    every 5 minutes
//   - missed-punch:     every 5 minutes
//   - retention-sweep:   daily 03:41 UTC
const SCHEDULES = {
  [QUEUE_NAMES.autoClockout]: '*/5 * * * *',
  [QUEUE_NAMES.missedPunch]: '*/5 * * * *',
  [QUEUE_NAMES.retentionSweep]: '41 3 * * *',
} as const;

// Queues that earlier releases scheduled but that no longer exist.
// Appliances upgraded from those releases still carry the repeatable
// schedule in Redis; with no consumer left, it would enqueue one
// orphaned job per firing forever. Removed best-effort on every boot.
const RETIRED_QUEUES = ['license-heartbeat'] as const;

async function removeRetiredSchedules(): Promise<void> {
  for (const name of RETIRED_QUEUES) {
    const queue = new Queue(name, { connection: getRedisConnection(), prefix: QUEUE_PREFIX });
    try {
      await queue.removeJobScheduler(`${name}:default`);
      await queue.obliterate({ force: true });
    } catch (err) {
      logger.warn({ err, queue: name }, 'failed to remove retired queue schedule');
    } finally {
      await queue.close().catch(() => undefined);
    }
  }
}

/**
 * Register the repeatable jobs. Idempotent — BullMQ's
 * upsertJobScheduler dedupes by scheduler id so calling this on every
 * boot is safe.
 */
export async function scheduleRepeatableJobs(): Promise<void> {
  await removeRetiredSchedules();
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
 * Remove the repeatable schedules. Used by the dev "reset queues"
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
