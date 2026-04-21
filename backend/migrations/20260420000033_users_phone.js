// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * `users.phone` — appliance-wide phone for user accounts (specifically
 * SuperAdmins, though any user can have one). Distinct from
 * `employees.phone` which is per-company and tied to the company's
 * SMS provider.
 *
 * Nullable because it's optional — email-only users keep working.
 * `phone_verified_at` mirrors the employees column, exists for
 * future-proofing (magic-link-by-phone for users, admin SMS
 * notifications, etc).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.string('phone', 32).nullable();
    t.timestamp('phone_verified_at', { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('phone_verified_at');
    t.dropColumn('phone');
  });
};
