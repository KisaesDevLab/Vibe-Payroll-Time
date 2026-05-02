// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Queue } from 'bullmq';
import { getRedisConnection } from './connection.js';

// Queue names are stable identifiers — appear in Redis keys, in
// /api/v1/health output, and in BullBoard if anyone hooks one up.
// Don't rename casually.
export const QUEUE_NAMES = {
  autoClockout: 'vpt:auto-clockout',
  missedPunch: 'vpt:missed-punch',
  licenseHeartbeat: 'vpt:license-heartbeat',
  retentionSweep: 'vpt:retention-sweep',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

let cachedQueues: Record<QueueName, Queue> | undefined;

function buildQueues(): Record<QueueName, Queue> {
  const connection = getRedisConnection();
  return {
    [QUEUE_NAMES.autoClockout]: new Queue(QUEUE_NAMES.autoClockout, { connection }),
    [QUEUE_NAMES.missedPunch]: new Queue(QUEUE_NAMES.missedPunch, { connection }),
    [QUEUE_NAMES.licenseHeartbeat]: new Queue(QUEUE_NAMES.licenseHeartbeat, { connection }),
    [QUEUE_NAMES.retentionSweep]: new Queue(QUEUE_NAMES.retentionSweep, { connection }),
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
