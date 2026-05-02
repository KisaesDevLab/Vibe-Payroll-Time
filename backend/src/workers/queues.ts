// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Queue } from 'bullmq';
import { getRedisConnection } from './connection.js';

// Queue names are stable identifiers — appear in Redis keys, in
// /api/v1/health output, and in BullBoard if anyone hooks one up.
// Don't rename casually.
//
// The `vpt:` namespacing is applied via BullMQ's `prefix` option (not the
// queue name) because bullmq>=5.76 rejects `:` in queue names. The Redis
// keyspace remains `vpt:<queue>:*` — only the in-memory name string changed.
export const QUEUE_PREFIX = 'vpt';

export const QUEUE_NAMES = {
  autoClockout: 'auto-clockout',
  missedPunch: 'missed-punch',
  licenseHeartbeat: 'license-heartbeat',
  retentionSweep: 'retention-sweep',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let cachedQueues: Record<QueueName, Queue> | undefined;

function buildQueues(): Record<QueueName, Queue> {
  const connection = getRedisConnection();
  const opts = { connection, prefix: QUEUE_PREFIX };
  return {
    [QUEUE_NAMES.autoClockout]: new Queue(QUEUE_NAMES.autoClockout, opts),
    [QUEUE_NAMES.missedPunch]: new Queue(QUEUE_NAMES.missedPunch, opts),
    [QUEUE_NAMES.licenseHeartbeat]: new Queue(QUEUE_NAMES.licenseHeartbeat, opts),
    [QUEUE_NAMES.retentionSweep]: new Queue(QUEUE_NAMES.retentionSweep, opts),
  };
}

export function getQueues(): Record<QueueName, Queue> {
  if (!cachedQueues) cachedQueues = buildQueues();
  return cachedQueues;
}

export async function closeQueues(): Promise<void> {
  if (!cachedQueues) return;
  for (const q of Object.values(cachedQueues)) {
    await q.close().catch(() => undefined);
  }
  cachedQueues = undefined;
}
