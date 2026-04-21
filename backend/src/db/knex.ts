// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { fileURLToPath } from 'node:url';
import knex, { type Knex } from 'knex';
import pg from 'pg';
import { env } from '../config/env.js';

// By default pg returns BIGINT (OID 20) and NUMERIC (OID 1700) as strings to
// avoid precision loss. Our row IDs (companies, employees, time entries) are
// well under 2^53, so parsing them as Number produces the same values the
// API schemas (and the frontend) already expect. This resolves a whole
// family of subtle bugs where a Map keyed by pg-string "1" is missed when
// looked up by a JSON-parsed number 1, and where JSON responses ship
// stringified IDs to a schema that types them as number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

const connection = env.DATABASE_URL ?? {
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
};

// Use fileURLToPath so Windows gets `C:\…\migrations` instead of the
// leading-slash `/C:/…/migrations` that `URL.pathname` produces, which
// Knex then walks from the cwd and double-prefixes.
const config: Knex.Config = {
  client: 'pg',
  connection,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: fileURLToPath(new URL('../../migrations', import.meta.url)),
    tableName: 'knex_migrations',
    extension: 'js',
  },
};

export const db = knex(config);

export async function checkDbConnectivity(): Promise<boolean> {
  try {
    await db.raw('select 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await db.destroy();
}
