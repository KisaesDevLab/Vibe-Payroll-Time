// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Two additions to `magic_links` so the same single-use-token machinery
 * backs both passwordless login and password reset, and so
 * admin-initiated resends are distinguishable from self-service ones.
 *
 *   purpose              'login' | 'password_reset'. Drives the TTL
 *                        (15m vs 30m), the notification template, and
 *                        the frontend landing route baked into the link.
 *                        Existing rows are all logins.
 *
 *   initiated_by_user_id NULL for self-service requests (someone typed
 *                        their address into the login page); set to the
 *                        admin's user id when a CompanyAdmin or
 *                        SuperAdmin pressed "send login link" for
 *                        somebody else.
 *
 * The rate limiter counts only self-service rows (`initiated_by_user_id
 * IS NULL`) — an admin resending a link four times while walking a new
 * hire through setup must not consume that employee's own 3-per-hour
 * budget and lock them out of self-service recovery. Hence the partial
 * index below rather than reusing the existing identifier index.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('magic_links', (t) => {
    t.string('purpose', 16).notNullable().defaultTo('login');
    t.bigInteger('initiated_by_user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
  });

  // Rate-limit lookup: "how many SELF-SERVICE requests for this
  // identifier in the last hour?" Partial so admin-initiated rows stay
  // out of the index entirely.
  await knex.raw(
    `CREATE INDEX magic_links_selfservice_rate_idx
     ON magic_links (identifier, created_at DESC)
     WHERE initiated_by_user_id IS NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS magic_links_selfservice_rate_idx');
  await knex.schema.alterTable('magic_links', (t) => {
    t.dropColumn('initiated_by_user_id');
    t.dropColumn('purpose');
  });
};
