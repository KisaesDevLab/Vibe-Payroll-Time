/**
 * Kiosk mode tables.
 *
 * `kiosk_pairing_codes` — one-time, short-lived (15 min) 8-digit codes an
 * admin generates for a specific company. An unpaired tablet visits
 * /kiosk/pair, submits the code, and in exchange receives a long-lived
 * device token.
 *
 * `kiosk_devices` — paired tablets. The actual device token is never
 * stored; only SHA-256(token). Admins can rename devices, view
 * last-seen-at, and revoke (setting revoked_at disables the device
 * without deleting the audit trail).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('kiosk_pairing_codes', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.string('code', 16).notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('consumed_at', { useTz: true }).nullable();
    t.bigInteger('issued_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['company_id', 'code']);
  });

  // Active (unconsumed, unexpired) codes are queried frequently during pair.
  await knex.raw(
    `CREATE INDEX kiosk_pairing_codes_active_idx
     ON kiosk_pairing_codes (code)
     WHERE consumed_at IS NULL`,
  );

  await knex.schema.createTable('kiosk_devices', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.string('name', 100).notNullable();
    // SHA-256 hex digest of the opaque device token.
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('paired_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_seen_at', { useTz: true }).nullable();
    t.timestamp('revoked_at', { useTz: true }).nullable();
    // Link back to the pairing code that birthed this device, for audit.
    t.bigInteger('pairing_code_id').references('id').inTable('kiosk_pairing_codes');
  });

  await knex.raw(
    `CREATE INDEX kiosk_devices_active_idx
     ON kiosk_devices (company_id)
     WHERE revoked_at IS NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('kiosk_devices');
  await knex.schema.dropTable('kiosk_pairing_codes');
};
