// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * User-level phone verification state. Same shape as
 * `phone_verifications` (per-employee) but co-located on `users`
 * since there's at most one active challenge per user at a time.
 *
 * Distinct from the per-employee phone verification because that flow
 * sends via the company's SMS provider, while this one sends via the
 * appliance-wide provider (since user-level phone isn't company-scoped).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('phone_verify_code_hash', 72).nullable();
    t.timestamp('phone_verify_expires_at', { useTz: true }).nullable();
    t.smallint('phone_verify_attempts').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('phone_verify_attempts');
    t.dropColumn('phone_verify_expires_at');
    t.dropColumn('phone_verify_code_hash');
  });
};
