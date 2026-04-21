// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Employees. A `user_id` is nullable because kiosk-only employees don't need
 * a user account — they punch in at a shared tablet using their PIN.
 *
 * A partial unique index on `(company_id, pin_hash) WHERE status = 'active'`
 * ensures no two active employees in the same company share a PIN.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('employees', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.bigInteger('user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('first_name', 100).notNullable();
    t.string('last_name', 100).notNullable();
    t.string('employee_number', 50).nullable();
    t.string('email', 254).nullable();
    t.string('phone', 32).nullable();
    t.string('pin_hash', 72).nullable();
    t.enu('status', ['active', 'terminated'], {
      useNative: true,
      enumName: 'employee_status',
    })
      .notNullable()
      .defaultTo('active');
    t.date('hired_at').nullable();
    t.timestamp('terminated_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['company_id', 'employee_number']);
  });

  await knex.raw(
    `CREATE UNIQUE INDEX employees_active_pin_unique_idx
     ON employees (company_id, pin_hash)
     WHERE status = 'active' AND pin_hash IS NOT NULL`,
  );

  await knex.raw('CREATE INDEX employees_company_status_idx ON employees (company_id, status)');
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('employees');
  await knex.raw('DROP TYPE IF EXISTS employee_status');
};
