// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * `jobs` — per-company catalogue of job / project / customer codes that
 * employees can associate with work entries. Not tied to accounting; a job
 * is just a label on time.
 *
 * `code` is unique within a company; it's intended to match what the
 * customer uses in their existing workflow (job number, project code,
 * customer code).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('jobs', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.string('code', 64).notNullable();
    t.string('name', 200).notNullable();
    t.text('description').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('archived_at', { useTz: true }).nullable();

    t.unique(['company_id', 'code']);
  });

  await knex.raw(
    'CREATE INDEX jobs_company_active_idx ON jobs (company_id) WHERE archived_at IS NULL',
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('jobs');
};
