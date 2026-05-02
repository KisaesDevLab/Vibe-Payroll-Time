// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import os from 'node:os';
import { logger } from '../config/logger.js';
import { getRedisConnection } from './connection.js';
import { QUEUE_NAMES, type QueueName } from './queues.js';

// Worker heartbeats live at vpt:worker:heartbeat:<queue>:<host>:<pid>
// with a TTL slightly longer than the heartbeat interval so a crashed
// worker's key disappears within ~2x interval. The HTTP /health route
// reads these keys to report per-queue worker liveness.
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TTL_SECONDS = 45;

const heartbeatKey = (queue: QueueName) =>
  `vpt:worker:heartbeat:${queue}:${os.hostname()}:${process.pid}`;

const heartbeatPattern = (queue: QueueName) => `vpt:worker:heartbeat:${queue}:*`;

export function startHeartbeats(queues: QueueName[]): () => void {
  const conn = getRedisConnection();
  const tick = async () => {
    const ts = new Date().toISOString();
    for (const q of queues) {
      try {
        await conn.set(heartbeatKey(q), ts, 'EX', HEARTBEAT_TTL_SECONDS);
      } catch (err) {
        logger.warn({ err, queue: q }, 'worker heartbeat write failed');
      }
    }
  };
  void tick();
  const interval = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
  return () => {
    clearInterval(interval);
    // Best-effort key cleanup so a graceful shutdown clears its own
    // heartbeat instead of leaving it to expire by TTL.
    void Promise.all(queues.map((q) => conn.del(heartbeatKey(q)).catch(() => undefined)));
  };
}

export type WorkerHeartbeatStatus = {
  queue: QueueName;
  liveCount: number;
};

/**
 * Read live worker heartbeats per queue. Returns one row per queue,
 * with a count of distinct heartbeat keys found in Redis. Used by
 * /api/v1/health to report whether at least one consumer is processing
 * each queue.
 *
 * Runs the four KEYS lookups in parallel and races each against a
 * 1.5s budget so a slow Redis can't stretch /health past the 3s
 * upstream LB threshold. KEYS is O(N) on the Redis keyspace but at
 * appliance scale (a handful of heartbeat keys total) it stays well
 * under the budget on a healthy instance.
 */
export async function readQueueHeartbeats(): Promise<WorkerHeartbeatStatus[]> {
  const conn = getRedisConnection();
  const queues = Object.values(QUEUE_NAMES) as QueueName[];
  const PER_CALL_BUDGET_MS = 1500;
  const racePerQueue = (q: QueueName) =>
    Promise.race<WorkerHeartbeatStatus>([
      conn
        .keys(heartbeatPattern(q))
        .then((keys) => ({ queue: q, liveCount: keys.length }))
        .catch(() => ({ queue: q, liveCount: 0 })),
      new Promise((resolve) =>
        setTimeout(() => resolve({ queue: q, liveCount: 0 }), PER_CALL_BUDGET_MS),
      ),
    ]);
  return Promise.all(queues.map(racePerQueue));
}
