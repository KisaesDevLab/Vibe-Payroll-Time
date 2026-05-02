// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { Worker } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { closeRedisConnection } from './connection.js';
import { startHeartbeats } from './heartbeat.js';
import { startWorkers } from './processors.js';
import { QUEUE_NAMES, closeQueues, type QueueName } from './queues.js';
import { scheduleRepeatableJobs } from './scheduler.js';

// Background-job lifecycle. Phase 14 replaces four standalone
// node-cron schedulers with a Redis-backed BullMQ system. The runtime
// has three roles, selected by WORKER_ROLE:
//
//   - "all"   (default for standalone): API process schedules AND
//             consumes jobs. One container, no operator changes.
//   - "scheduler": only enqueues repeatable jobs. The appliance
//             API container uses this so it doesn't compete with the
//             dedicated worker container.
//   - "worker":   only consumes jobs. The appliance worker container
//             uses this; entrypoint is dist/worker.js.
//
// WORKERS_ENABLED=false short-circuits everything (used by tests and
// by dev environments without Redis available). When disabled, the
// run*() functions remain callable directly so business logic is
// still testable.

export type WorkerRole = 'all' | 'scheduler' | 'worker';

export type BackgroundJobsHandle = {
  stop: () => Promise<void>;
};

export async function startBackgroundJobs(): Promise<BackgroundJobsHandle> {
  if (!env.WORKERS_ENABLED) {
    logger.info('background jobs disabled (WORKERS_ENABLED=false)');
    return { stop: async () => undefined };
  }

  // worker.ts overrides WORKER_ROLE before importing this module, so
  // re-read process.env here rather than the cached env.WORKER_ROLE
  // which was parsed at first env.ts import.
  const role = (process.env.WORKER_ROLE ?? env.WORKER_ROLE) as WorkerRole;
  logger.info(
    { role, redisUrl: env.REDIS_URL.replace(/:[^:@]*@/, ':***@') },
    'starting background jobs',
  );

  let workers: Worker[] = [];
  let stopHeartbeats: (() => void) | undefined;

  if (role === 'all' || role === 'scheduler') {
    await scheduleRepeatableJobs();
  }

  if (role === 'all' || role === 'worker') {
    workers = startWorkers();
    stopHeartbeats = startHeartbeats(Object.values(QUEUE_NAMES) as QueueName[]);
  }

  return {
    stop: async () => {
      logger.info('stopping background jobs');
      if (stopHeartbeats) stopHeartbeats();
      // Graceful close: wait up to 8s for in-flight jobs (notify-call
      // path can stall on a misconfigured SMS provider, retention
      // sweep can stall on a slow disk). 8s sits well inside Docker's
      // default 10s SIGTERM grace so the force-close gets a chance
      // to fire before the engine SIGKILLs us. We don't `await` the
      // forced-close promise so a still-hung w.close() can't keep the
      // outer Promise.all alive past the timer.
      await Promise.all(
        workers.map(
          (w) =>
            new Promise<void>((resolve) => {
              let settled = false;
              const finalize = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
              };
              const timer = setTimeout(() => {
                if (settled) return;
                logger.warn({ queue: w.name }, 'worker close timeout — forcing');
                w.close(true).catch(() => undefined);
                finalize();
              }, 8_000);
              w.close()
                .catch(() => undefined)
                .finally(finalize);
            }),
        ),
      );
      await closeQueues();
      await closeRedisConnection();
    },
  };
}
