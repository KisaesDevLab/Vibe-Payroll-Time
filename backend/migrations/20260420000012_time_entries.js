/**
 * `time_entries` — the core mutation target of the whole product.
 *
 * Invariants enforced by the schema (defence in depth; the service layer
 * also enforces them, but the index is the ultimate arbiter):
 *   - Exactly 0 or 1 open entry per (company_id, employee_id) at any time
 *     (partial unique index `ended_at IS NULL`).
 *   - Entries soft-delete via `deleted_at` — the audit trail depends on
 *     no rows ever disappearing.
 *
 * `shift_id` is a UUID stamped at clock-in and preserved through breaks
 * and job switches, so a shift can be reconstructed as all entries
 * sharing it.
 *
 * Offline punches carry `client_started_at` + `client_clock_skew_ms`.
 * The server still owns `started_at` (adjusted for skew), but we keep
 * the raw client values for forensics.
 */
exports.up = async function up(knex) {
  // Ensure gen_random_uuid() is available for shift_id defaults.
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await knex.schema.createTable('time_entries', (t) => {
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
    t.uuid('shift_id').notNullable();

    t.enu('entry_type', ['work', 'break'], {
      useNative: true,
      enumName: 'time_entry_type',
    }).notNullable();

    t.bigInteger('job_id').nullable().references('id').inTable('jobs').onDelete('SET NULL');

    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true }).nullable();
    t.bigInteger('duration_seconds').nullable();

    // Source metadata (who/what created the entry).
    t.enu('source', ['kiosk', 'web', 'mobile_pwa'], {
      useNative: true,
      enumName: 'time_entry_source',
    }).notNullable();
    t.string('source_device_id', 128).nullable();
    t.boolean('source_offline').notNullable().defaultTo(false);
    t.timestamp('client_started_at', { useTz: true }).nullable();
    t.integer('client_clock_skew_ms').nullable();

    // Audit / edit tracking (summary; full history lives in
    // time_entry_audit).
    t.bigInteger('created_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.bigInteger('edited_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.text('edit_reason').nullable();

    t.timestamp('approved_at', { useTz: true }).nullable();
    t.bigInteger('approved_by').nullable().references('id').inTable('users').onDelete('SET NULL');

    t.boolean('is_auto_closed').notNullable().defaultTo(false);

    t.timestamp('deleted_at', { useTz: true }).nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.check(
      'ended_at IS NULL OR ended_at >= started_at',
      [],
      'time_entries_ended_after_started',
    );
  });

  // One open entry per employee. The index also speeds up the "find my
  // current open entry" lookup performed on every punch.
  await knex.raw(
    `CREATE UNIQUE INDEX time_entries_open_unique_idx
     ON time_entries (company_id, employee_id)
     WHERE ended_at IS NULL AND deleted_at IS NULL`,
  );

  // Primary read index for timesheets and reports.
  await knex.raw(
    `CREATE INDEX time_entries_company_employee_started_idx
     ON time_entries (company_id, employee_id, started_at DESC)
     WHERE deleted_at IS NULL`,
  );

  // Secondary index for pay-period / date-range scans at the company level.
  await knex.raw(
    `CREATE INDEX time_entries_company_started_idx
     ON time_entries (company_id, started_at)
     WHERE deleted_at IS NULL`,
  );

  // Shift reconstruction.
  await knex.raw(
    `CREATE INDEX time_entries_shift_idx ON time_entries (shift_id)`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('time_entries');
  await knex.raw('DROP TYPE IF EXISTS time_entry_type');
  await knex.raw('DROP TYPE IF EXISTS time_entry_source');
};
