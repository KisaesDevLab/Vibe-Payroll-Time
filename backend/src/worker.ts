// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { logger } from './config/logger.js';
import { closeDb } from './db/knex.js';
import { waitForDb } from './db/wait.js';
import { startBackgroundJobs } from './workers/runtime.js';

// Standalone worker entrypoint. Used by the appliance compose's
// `vibe-payroll-worker` service to consume BullMQ queues without
// running the HTTP API. Forces WORKER_ROLE=worker so the same image
// can serve both API and worker roles via different commands.

async function main() {
  process.env.WORKER_ROLE = 'worker';
  logger.info('vibept worker starting');

  await waitForDb();

  const handle = await startBackgroundJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down worker');
    await handle.stop();
    await closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('vibept worker ready');
}

main().catch((err) => {
  logger.fatal({ err }, 'worker boot failure');
  process.exit(1);
});
