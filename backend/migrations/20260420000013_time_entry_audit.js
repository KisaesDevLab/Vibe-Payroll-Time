/**
 * `time_entry_audit` — append-only change log for time_entries. Every
 * edit/approve/delete/auto-close writes one row here. Create rows are also
 * written to give a complete provenance trail.
 *
 * `actor_user_id` is nullable for cron-driven changes (auto-close).
 * `field` is NULL for lifecycle actions that don't target a specific
 * column (create, delete, auto_close, approve/unapprove).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('time_entry_audit', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('time_entry_id')
      .notNullable()
      .references('id')
      .inTable('time_entries')
      .onDelete('CASCADE');
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');

    t.bigInteger('actor_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');

    t.enu(
      'action',
      ['create', 'edit', 'approve', 'unapprove', 'delete', 'auto_close'],
      { useNative: true, enumName: 'time_entry_audit_action' },
    ).notNullable();

    t.string('field', 64).nullable();
    t.jsonb('old_value').nullable();
    t.jsonb('new_value').nullable();
    t.text('reason').nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX time_entry_audit_entry_created_idx
     ON time_entry_audit (time_entry_id, created_at DESC)`,
  );

  await knex.raw(
    `CREATE INDEX time_entry_audit_company_created_idx
     ON time_entry_audit (company_id, created_at DESC)`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('time_entry_audit');
  await knex.raw('DROP TYPE IF EXISTS time_entry_audit_action');
};
