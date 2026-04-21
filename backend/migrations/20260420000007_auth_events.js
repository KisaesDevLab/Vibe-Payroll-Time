// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * `auth_events` logs every auth-sensitive action: login success/failure,
 * refresh, logout, password change, setup completion, etc. `user_id` and
 * `company_id` are nullable because we log events like failed logins where
 * the user may not resolve.
 *
 * Designed for evidentiary use by a CPA firm in a security review — we never
 * drop or edit rows here, only append.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('auth_events', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.bigInteger('company_id')
      .nullable()
      .references('id')
      .inTable('companies')
      .onDelete('SET NULL');
    t.string('event_type', 64).notNullable();
    t.string('ip', 64).nullable();
    t.string('user_agent', 512).nullable();
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    'CREATE INDEX auth_events_user_created_idx ON auth_events (user_id, created_at DESC)',
  );
  await knex.raw('CREATE INDEX auth_events_type_idx ON auth_events (event_type)');
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('auth_events');
};
