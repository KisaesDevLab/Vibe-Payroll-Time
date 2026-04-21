/**
 * Add per-punch network attribution to time_entries.
 *
 * Before: only source + source_device_id were stored, so "who punched
 * from what IP" could only be inferred by joining auth_events by time
 * proximity, which (a) doesn't work for kiosk punches (no user session)
 * and (b) gets ambiguous under load.
 *
 * After: every punch carries the remote IP and user-agent it came from,
 * captured at the HTTP layer. Both nullable — existing rows stay null,
 * and some punch paths (auto-clock-out cron, test fixtures) have no
 * originating request to attribute.
 *
 *   source_ip            IPv4 or IPv6 textual form; stored raw so the
 *                        Punch activity report can substring-match a
 *                        subnet without parsing.
 *   source_user_agent    Truncated to 512 chars to match auth_events.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('time_entries', (t) => {
    t.string('source_ip', 64).nullable();
    t.string('source_user_agent', 512).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('time_entries', (t) => {
    t.dropColumn('source_ip');
    t.dropColumn('source_user_agent');
  });
};
