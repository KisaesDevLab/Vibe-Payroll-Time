import knex, { type Knex } from 'knex';
import { env } from '../config/env.js';

const connection = env.DATABASE_URL ?? {
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
};

const config: Knex.Config = {
  client: 'pg',
  connection,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: new URL('../../migrations', import.meta.url).pathname,
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
