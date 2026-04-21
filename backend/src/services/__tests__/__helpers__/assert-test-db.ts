import { db } from '../../../db/knex.js';

/**
 * Hard guard: integration tests TRUNCATE core tables. If somebody
 * accidentally runs vitest with the wrong config (e.g. from the repo
 * root, which bypasses `backend/vitest.config.ts`), we must refuse to
 * touch any database whose name doesn't look like a dedicated test DB.
 *
 * Call this at the top of every integration test's `beforeAll` — it's
 * cheap (one round-trip) and bails before the first TRUNCATE runs.
 *
 * This is belt-and-suspenders on top of `POSTGRES_DB_TEST ?? 'vibept_test'`
 * in vitest.config.ts — that env default is the primary guarantee; this
 * assertion is the fallback when someone bypasses the config.
 */
export async function assertPointedAtTestDb(): Promise<void> {
  const row = await db.raw<{ rows: Array<{ db: string }> }>(`SELECT current_database() AS db`);
  const name = row.rows[0]?.db ?? '';
  if (!name.endsWith('_test') && name !== 'vitest') {
    throw new Error(
      `[integration test safety] refusing to run — connected to "${name}". ` +
        `Integration tests TRUNCATE tables and must only run against a DB ` +
        `whose name ends in "_test". Check that you're in backend/ and ` +
        `POSTGRES_DB_TEST (default: vibept_test) is set.`,
    );
  }
}
