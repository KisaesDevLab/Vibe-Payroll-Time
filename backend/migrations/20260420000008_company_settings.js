/**
 * `company_settings` — one row per company. Created alongside the company
 * row in a transaction; callers can assume a row exists for every non-deleted
 * company.
 *
 * Twilio and SMTP secrets are stored encrypted with the appliance-wide
 * AES-256-GCM key (SECRETS_ENCRYPTION_KEY env var). The ciphertext columns
 * hold a base64url-encoded `iv|ciphertext|authTag` blob.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('company_settings', (t) => {
    t.bigInteger('company_id')
      .primary()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');

    // --- Punch rules -----------------------------------------------------
    t.enu('punch_rounding_mode', ['none', '1min', '5min', '6min', '15min'], {
      useNative: true,
      enumName: 'punch_rounding_mode',
    })
      .notNullable()
      .defaultTo('none');
    t.smallint('punch_rounding_grace_minutes').notNullable().defaultTo(0);
    t.check(
      'punch_rounding_grace_minutes >= 0 AND punch_rounding_grace_minutes <= 15',
      [],
      'punch_rounding_grace_bounds',
    );

    // --- Auto-clockout and reminders -------------------------------------
    t.smallint('auto_clockout_hours').notNullable().defaultTo(12);
    t.check(
      'auto_clockout_hours >= 4 AND auto_clockout_hours <= 24',
      [],
      'auto_clockout_hours_bounds',
    );
    t.smallint('missed_punch_reminder_hours').notNullable().defaultTo(12);

    // --- Approval --------------------------------------------------------
    t.boolean('supervisor_approval_required').notNullable().defaultTo(false);
    t.boolean('allow_self_approve').notNullable().defaultTo(false);

    // --- Auth surfaces ---------------------------------------------------
    t.boolean('kiosk_enabled').notNullable().defaultTo(false);
    t.boolean('personal_device_enabled').notNullable().defaultTo(true);
    t.check(
      'kiosk_enabled = TRUE OR personal_device_enabled = TRUE',
      [],
      'at_least_one_auth_surface',
    );

    // --- Notifications (encrypted secrets) -------------------------------
    t.string('twilio_account_sid', 64).nullable();
    t.text('twilio_auth_token_encrypted').nullable();
    t.string('twilio_from_number', 32).nullable();
    t.string('smtp_host', 254).nullable();
    t.integer('smtp_port').nullable();
    t.string('smtp_user', 254).nullable();
    t.text('smtp_pass_encrypted').nullable();
    t.string('smtp_from', 254).nullable();

    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Backfill any companies that pre-date this migration with default settings.
  const companies = await knex('companies').select('id', 'is_internal');
  if (companies.length > 0) {
    await knex('company_settings').insert(
      companies.map((c) => ({
        company_id: c.id,
        // Internal firms default to self-approve so a solo practitioner can
        // approve their own pay periods without a separate supervisor seat.
        allow_self_approve: c.is_internal,
      })),
    );
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('company_settings');
  await knex.raw('DROP TYPE IF EXISTS punch_rounding_mode');
};
