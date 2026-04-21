// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Per-employee notification preferences + phone-verification state.
 *
 * Email opt-in is straightforward (defaults to true — the admin told
 * us their email, we can send). SMS requires an explicit opt-in AND a
 * verified phone number. `phone_verified_at` is stamped when the
 * employee completes the 6-digit SMS code flow.
 *
 * `phone_verifications` holds pending codes; one active (unused,
 * unexpired) row per employee at a time.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.boolean('email_notifications_enabled').notNullable().defaultTo(true);
    t.boolean('sms_notifications_enabled').notNullable().defaultTo(false);
    t.timestamp('phone_verified_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('phone_verifications', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('employee_id')
      .notNullable()
      .references('id')
      .inTable('employees')
      .onDelete('CASCADE');
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    // bcrypt hash of the 6-digit code — low entropy but short-lived
    // and rate-limited. Hashing keeps a DB dump from yielding the
    // code in cleartext.
    t.string('code_hash', 72).notNullable();
    t.string('phone', 32).notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('verified_at', { useTz: true }).nullable();
    t.smallint('attempts').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE UNIQUE INDEX phone_verifications_active_idx
     ON phone_verifications (employee_id)
     WHERE verified_at IS NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('phone_verifications');
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('email_notifications_enabled');
    t.dropColumn('sms_notifications_enabled');
    t.dropColumn('phone_verified_at');
  });
};
