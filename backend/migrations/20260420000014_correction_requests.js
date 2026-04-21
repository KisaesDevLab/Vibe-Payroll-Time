// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * `correction_requests` — employee-initiated timesheet corrections that a
 * manager reviews. On approval, the punch service applies the change
 * through its normal chokepoint so the edit lands in the audit trail
 * alongside all other mutations.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('correction_requests', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.bigInteger('employee_id')
      .notNullable()
      .references('id')
      .inTable('employees')
      .onDelete('CASCADE');
    t.bigInteger('time_entry_id')
      .nullable()
      .references('id')
      .inTable('time_entries')
      .onDelete('SET NULL');
    t.bigInteger('requester_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    t.enu('request_type', ['edit', 'add', 'delete'], {
      useNative: true,
      enumName: 'correction_request_type',
    }).notNullable();

    t.jsonb('proposed_changes').notNullable();
    t.text('reason').notNullable();

    t.enu('status', ['pending', 'approved', 'rejected'], {
      useNative: true,
      enumName: 'correction_request_status',
    })
      .notNullable()
      .defaultTo('pending');

    t.bigInteger('reviewed_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('reviewed_at', { useTz: true }).nullable();
    t.text('review_note').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX correction_requests_company_status_idx
     ON correction_requests (company_id, status, created_at DESC)`,
  );
  await knex.raw(
    `CREATE INDEX correction_requests_employee_idx
     ON correction_requests (employee_id, created_at DESC)`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('correction_requests');
  await knex.raw('DROP TYPE IF EXISTS correction_request_type');
  await knex.raw('DROP TYPE IF EXISTS correction_request_status');
};
