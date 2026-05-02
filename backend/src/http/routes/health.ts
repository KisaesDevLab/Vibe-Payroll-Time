// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Router } from 'express';
import { env } from '../../config/env.js';
import { checkDbConnectivity } from '../../db/knex.js';
import { getMigrationStatus } from '../../db/migrate.js';
import { VERSION, GIT_SHA, BUILD_DATE } from '../../version.js';

const startedAt = Date.now();

export const pingRouter: Router = Router();

// Cheapest possible liveness probe — no DB, no Redis, no service touch.
// Used by upstream load balancers (Caddy, HAProxy in the appliance) to
// answer "is this Node process up?" without coupling that signal to
// dependency health. Reserve `/health` and `/health/ready` for readiness.
pingRouter.get('/', (_req, res) => {
  res.json({ data: { status: 'ok' } });
});

export const healthRouter: Router = Router();

healthRouter.get('/', async (_req, res) => {
  // Workers are non-essential to /health's "is the API up?" answer —
  // they're orthogonal background processing. Report their status as
  // a dedicated discriminated field so an operator dashboard can
  // distinguish "background jobs are off" from "Redis is unreachable"
  // from "Redis ok, n workers heartbeating", without /health going
  // red and tripping upstream alerts.
  type WorkersField =
    | { enabled: false }
    | {
        enabled: true;
        redis: 'ok' | 'unreachable';
        queues: Array<{ queue: string; liveCount: number }>;
      };
  let workers: WorkersField = { enabled: false };
  if (env.WORKERS_ENABLED) {
    // Belt-and-suspenders: cap the entire heartbeat read at 2s so a
    // truly stuck Redis can never block /health past the LB probe
    // budget. Inner per-call timeouts in readQueueHeartbeats already
    // bound this; the outer race is defense-in-depth against a future
    // ioredis change that loses its inner timeout.
    const HEALTH_BUDGET_MS = 2_000;
    try {
      const heartbeatModule = await import('../../workers/heartbeat.js');
      type Result = Awaited<ReturnType<typeof heartbeatModule.readQueueHeartbeats>>;
      const queues = await Promise.race<Result>([
        heartbeatModule.readQueueHeartbeats(),
        new Promise<Result>((_resolve, reject) =>
          setTimeout(() => reject(new Error('health budget exceeded')), HEALTH_BUDGET_MS),
        ),
      ]);
      workers = { enabled: true, redis: 'ok', queues };
    } catch {
      // Redis unreachable or slow — surface as a structured shape
      // rather than 500ing. /ping is the dependency-free liveness
      // probe.
      workers = { enabled: true, redis: 'unreachable', queues: [] };
    }
  }

  res.json({
    data: {
      status: 'ok',
      service: 'vibept-api',
      version: VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      workers,
    },
  });
});

healthRouter.get('/ready', async (_req, res) => {
  const dbOk = await checkDbConnectivity();
  let migrationsOk = false;
  let pending: string[] = [];

  if (dbOk) {
    try {
      const status = await getMigrationStatus();
      pending = status.pending;
      migrationsOk = pending.length === 0;
    } catch {
      migrationsOk = false;
    }
  }

  const ready = dbOk && migrationsOk;
  res.status(ready ? 200 : 503).json({
    data: {
      status: ready ? 'ready' : 'not_ready',
      checks: {
        db: dbOk ? 'ok' : 'fail',
        migrations: migrationsOk ? 'ok' : 'fail',
      },
      pendingMigrations: pending,
      timestamp: new Date().toISOString(),
    },
  });
});

export const versionRouter: Router = Router();

versionRouter.get('/', (_req, res) => {
  res.json({
    data: {
      version: VERSION,
      gitSha: GIT_SHA,
      buildDate: BUILD_DATE,
    },
  });
});

// Public appliance metadata — no auth. Used by the login page and
// magic-link consume page so they render the operator's custom brand
// name before anyone authenticates.
export const applianceInfoRouter: Router = Router();

applianceInfoRouter.get('/', async (_req, res, next) => {
  try {
    const { getResolvedDisplayName } = await import('../../services/appliance-settings.js');
    const { getTenantModeInfo } = await import('../../services/tenant-mode.js');
    const displayName = await getResolvedDisplayName();
    const tenant = getTenantModeInfo();
    res.json({ data: { displayName, tenantMode: tenant.mode, firmName: tenant.firmName } });
  } catch (err) {
    next(err);
  }
});
