/**
 * Phase 4.5 — QR badge authentication.
 *
 *   - employees gains four nullable badge columns; `badge_version` starts
 *     at 0 and increments each time a badge is (re)issued. The raw
 *     payload is never persisted — only its sha256.
 *   - company_settings gains `kiosk_auth_mode` (pin | qr | both). Default
 *     `pin` preserves existing behavior for every pre-existing company.
 *   - Partial unique index on (company_id, badge_token_hash) WHERE not
 *     revoked prevents two active badges from colliding on the same hash
 *     within a company; revoked badges are free to sit in history.
 *   - `badge_events` is append-only, mirrors the shape/retention story of
 *     `auth_events`. Logged on every issue/revoke and on every scan
 *     attempt (success AND failure) so shared-badge abuse is visible
 *     in the audit trail.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.string('badge_token_hash', 64).nullable();
    t.timestamp('badge_issued_at', { useTz: true }).nullable();
    t.timestamp('badge_revoked_at', { useTz: true }).nullable();
    t.integer('badge_version').notNullable().defaultTo(0);
  });

  await knex.raw(
    `CREATE UNIQUE INDEX employees_active_badge_unique_idx
     ON employees (company_id, badge_token_hash)
     WHERE badge_revoked_at IS NULL AND badge_token_hash IS NOT NULL`,
  );

  await knex.schema.alterTable('company_settings', (t) => {
    t.enu('kiosk_auth_mode', ['pin', 'qr', 'both'], {
      useNative: true,
      enumName: 'kiosk_auth_mode',
    })
      .notNullable()
      .defaultTo('pin');
  });

  await knex.schema.createTable('badge_events', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.bigInteger('employee_id')
      .nullable()
      .references('id')
      .inTable('employees')
      .onDelete('SET NULL');
    t.enu('event_type', ['issue', 'revoke', 'scan_success', 'scan_failure'], {
      useNative: true,
      enumName: 'badge_event_type',
    }).notNullable();
    t.bigInteger('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.bigInteger('kiosk_device_id')
      .nullable()
      .references('id')
      .inTable('kiosk_devices')
      .onDelete('SET NULL');
    t.jsonb('metadata').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX badge_events_company_created_idx
     ON badge_events (company_id, created_at DESC)`,
  );
  await knex.raw(
    `CREATE INDEX badge_events_employee_created_idx
     ON badge_events (employee_id, created_at DESC)`,
  );
  await knex.raw(`CREATE INDEX badge_events_type_idx ON badge_events (event_type)`);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('badge_events');
  await knex.raw('DROP TYPE IF EXISTS badge_event_type');

  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('kiosk_auth_mode');
  });
  await knex.raw('DROP TYPE IF EXISTS kiosk_auth_mode');

  await knex.raw('DROP INDEX IF EXISTS employees_active_badge_unique_idx');
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('badge_token_hash');
    t.dropColumn('badge_issued_at');
    t.dropColumn('badge_revoked_at');
    t.dropColumn('badge_version');
  });
};
