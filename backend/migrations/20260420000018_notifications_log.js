// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * `notifications_log` — append-only record of every notification the
 * appliance attempts to send, whether email or SMS, whether from a
 * cron or a direct admin action.
 *
 * Used for:
 *   - admin UI "notifications sent" table
 *   - retry of failed sends (flip status back to `queued` + re-send)
 *   - debugging delivery problems without tailing pino logs
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('notifications_log', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');

    // 'employee' | 'user' — who we're sending to.
    t.string('recipient_type', 16).notNullable();
    t.bigInteger('recipient_id').nullable();
    t.string('recipient_address', 254).notNullable(); // email or phone

    t.string('channel', 16).notNullable(); // 'email' | 'sms'
    t.string('type', 64).notNullable(); // e.g. 'missed_punch_reminder'

    t.string('status', 16).notNullable().defaultTo('queued');
    t.string('provider_message_id', 128).nullable();
    t.text('error').nullable();

    t.timestamp('queued_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('sent_at', { useTz: true }).nullable();
    t.timestamp('failed_at', { useTz: true }).nullable();

    t.jsonb('payload').nullable(); // subject, body excerpt, etc. for debugging
  });

  await knex.raw(
    `CREATE INDEX notifications_log_company_queued_idx
     ON notifications_log (company_id, queued_at DESC)`,
  );
  await knex.raw(
    `CREATE INDEX notifications_log_status_idx
     ON notifications_log (status) WHERE status IN ('queued', 'failed')`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('notifications_log');
};
