import { Router } from 'express';
import { checkDbConnectivity } from '../../db/knex.js';
import { getMigrationStatus } from '../../db/migrate.js';
import { VERSION, GIT_SHA, BUILD_DATE } from '../../version.js';

const startedAt = Date.now();

export const healthRouter: Router = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    data: {
      status: 'ok',
      service: 'vibept-backend',
      version: VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
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
