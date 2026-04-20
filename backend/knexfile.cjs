/**
 * Knex config — plain CommonJS JS so `knex` CLI can load it directly without a
 * TS loader. Migrations themselves are plain `.js` under ./migrations for
 * cross-platform (Windows) compatibility.
 */
require('dotenv-flow').config({ silent: true });

const connection = process.env.DATABASE_URL || {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  user: process.env.POSTGRES_USER || 'vibept',
  password: process.env.POSTGRES_PASSWORD || 'vibept_dev',
  database: process.env.POSTGRES_DB || 'vibept',
};

/** @type {import('knex').Knex.Config} */
const base = {
  client: 'pg',
  connection,
  pool: { min: 2, max: 10 },
  migrations: {
    directory: './migrations',
    tableName: 'knex_migrations',
    extension: 'js',
  },
  seeds: {
    directory: './seeds',
    extension: 'js',
  },
};

module.exports = {
  development: base,
  test: {
    ...base,
    connection:
      process.env.DATABASE_URL_TEST ||
      (typeof connection === 'string'
        ? `${connection}_test`
        : { ...connection, database: `${connection.database}_test` }),
  },
  production: base,
};
