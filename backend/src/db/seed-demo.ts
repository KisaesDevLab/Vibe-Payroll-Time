// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { fileURLToPath } from 'node:url';
import { logger } from '../config/logger.js';
import { db } from './knex.js';

/**
 * Run the Acme Plumbing demo seed programmatically (same thing
 * `npm run seed:demo` does, just in-process after migrations). The
 * knex CLI resolves seeds/ relative to the knexfile's cwd; in-process
 * we have to pass an absolute directory so it works the same from
 * both `tsx` (dev) and the compiled container.
 *
 * Idempotent by design: the seed deletes its company by slug first.
 */
export async function runDemoSeed(): Promise<void> {
  const directory = fileURLToPath(new URL('../../seeds', import.meta.url));
  const start = Date.now();
  const [ran] = (await db.seed.run({
    directory,
    extension: 'js',
  })) as [string[]];
  const elapsed = Date.now() - start;
  logger.info({ elapsed, files: ran }, `ran ${ran.length} seed file(s)`);
}
