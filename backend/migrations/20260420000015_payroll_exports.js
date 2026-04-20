/**
 * `payroll_exports` — one row per CSV run, scoped to a company and a
 * pay-period window. The CSV itself lives on disk under EXPORTS_DIR
 * (configurable); this table carries metadata + a hash so we can
 * verify a later download matches what was originally generated.
 *
 * Re-exports are allowed; each produces a new row. `replaced_by_id`
 * links the earlier row to the later one so the history view can flag
 * "superseded by #123" instead of silently dropping the prior.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('payroll_exports', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.bigInteger('exported_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    t.timestamp('period_start', { useTz: true }).notNullable();
    t.timestamp('period_end', { useTz: true }).notNullable();

    // 'payroll_relief' | 'gusto' | 'qbo_payroll' | 'generic_csv'
    t.string('format', 32).notNullable();

    // Relative path under EXPORTS_DIR. Opaque to the app; only the
    // download handler interprets it.
    t.string('file_path', 512).notNullable();
    t.string('file_hash', 64).notNullable(); // hex sha256
    t.bigInteger('file_bytes').notNullable();
    t.integer('employee_count').notNullable();
    t.bigInteger('total_work_seconds').notNullable();

    t.bigInteger('replaced_by_id')
      .nullable()
      .references('id')
      .inTable('payroll_exports')
      .onDelete('SET NULL');

    t.text('notes').nullable();
    t.timestamp('exported_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX payroll_exports_company_period_idx
     ON payroll_exports (company_id, period_start, period_end)`,
  );
  await knex.raw(
    `CREATE INDEX payroll_exports_history_idx
     ON payroll_exports (company_id, exported_at DESC)`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('payroll_exports');
};
