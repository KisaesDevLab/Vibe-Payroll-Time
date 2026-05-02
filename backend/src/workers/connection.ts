// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';

// Single shared ioredis connection for BullMQ. BullMQ requires
// `maxRetriesPerRequest: null` and `enableReadyCheck: false` on
// connections used for blocking commands (worker BRPOPLPUSH polling).
// The library will warn if these aren't set.
//
// `connectTimeout: 3000` keeps `/api/v1/health` from blocking on a
// dead Redis for 10s (ioredis default) — upstream HAProxy / Caddy
// trip "backend down" alerts well before that. The /health route
// reports an empty workers array on connect-timeout and stays 200
// (workers are non-essential to API liveness; /ping is the
// liveness signal that doesn't touch Redis at all).
const redisOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 3000,
};

let connection: Redis | undefined;

export function getRedisConnection(): Redis {
  if (!connection) {
    connection = new Redis(env.REDIS_URL, redisOptions);
  }
  return connection;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = undefined;
  }
}
