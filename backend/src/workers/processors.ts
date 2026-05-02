// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Worker, type Processor } from 'bullmq';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { runAutoClockoutSweep } from '../services/auto-clockout.js';
import { runLicenseHeartbeat } from '../services/licensing/heartbeat.js';
import { runMissedPunchSweep } from '../services/notifications/missed-punch-cron.js';
import { runRetentionSweep } from '../services/retention.js';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAMES, type QueueName } from './queues.js';

// Each processor is a thin adapter around the existing run*() function.
// Keeping the business logic in services/ means BullMQ is purely a
// transport — the run*() functions remain directly callable from a
// REPL or test for out-of-band sweeps.
const processors: Record<QueueName, Processor> = {
  [QUEUE_NAMES.autoClockout]: async () => {
    const closed = await runAutoClockoutSweep();
    return { closed };
  },
  [QUEUE_NAMES.missedPunch]: async () => {
    const sent = await runMissedPunchSweep();
    return { sent };
  },
  [QUEUE_NAMES.licenseHeartbeat]: async () => {
    const ok = await runLicenseHeartbeat();
    return { ok };
  },
  [QUEUE_NAMES.retentionSweep]: async () => {
    await runRetentionSweep();
    return { ok: true };
  },
};

/**
 * Start a BullMQ Worker for each queue. Returns an array of Workers so
 * the caller can close them on graceful shutdown.
 */
export function startWorkers(): Worker[] {
  const connection = getRedisConnection();
  const workers: Worker[] = [];

  for (const queue of Object.values(QUEUE_NAMES)) {
    const worker = new Worker(queue, processors[queue], {
      connection,
      concurrency: env.WORKER_CONCURRENCY,
    });

    // The four run*() functions already log their own info-level
    // summary lines when there's something to report. Job-level
    // completion logging at info level would produce 1000+ noise
    // lines per day on a quiet appliance — keep it at debug.
    worker.on('completed', (job, result) => {
      logger.debug({ queue, jobId: job.id, result }, 'worker job completed');
    });
    worker.on('failed', (job, err) => {
      logger.error({ queue, jobId: job?.id, err }, 'worker job failed');
    });
    worker.on('error', (err) => {
      logger.error({ queue, err }, 'worker connection error');
    });

    workers.push(worker);
  }
  return workers;
}
