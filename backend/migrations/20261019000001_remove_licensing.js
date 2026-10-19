// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Remove licensing.
 *
 * The project is MIT-licensed: there is no commercial tier, no license
 * key, and no in-app enforcement any more. This drops every column the
 * license machinery owned:
 *
 *   companies:          license_state (+ the native `license_state` enum),
 *                       license_expires_at, license_key_encrypted,
 *                       license_claims, license_issued_at,
 *                       last_license_check_at (+ companies_license_state_idx)
 *   appliance_settings: license_key_encrypted, license_claims,
 *                       license_state, license_issued_at,
 *                       license_expires_at, last_license_check_at
 *
 * `companies.is_internal` stays: it marks the firm's own company, which
 * single sign-on uses (services/vibe-auth/realm.ts).
 *
 * `down` restores the columns empty (no license data survives a round
 * trip), with `license_state` derived from is_internal the way company
 * creation used to set it.
 */
exports.up = async function up(knex) {
  await knex.raw('DROP INDEX IF EXISTS companies_license_state_idx');
  await knex.schema.alterTable('companies', (t) => {
    t.dropColumn('license_state');
    t.dropColumn('license_expires_at');
    t.dropColumn('license_key_encrypted');
    t.dropColumn('license_claims');
    t.dropColumn('license_issued_at');
    t.dropColumn('last_license_check_at');
  });
  await knex.raw('DROP TYPE IF EXISTS license_state');

  await knex.schema.alterTable('appliance_settings', (t) => {
    t.dropColumn('license_key_encrypted');
    t.dropColumn('license_claims');
    t.dropColumn('license_state');
    t.dropColumn('license_issued_at');
    t.dropColumn('license_expires_at');
    t.dropColumn('last_license_check_at');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.text('license_key_encrypted').nullable();
    t.jsonb('license_claims').nullable();
    t.string('license_state', 16).nullable();
    t.timestamp('license_issued_at', { useTz: true }).nullable();
    t.timestamp('license_expires_at', { useTz: true }).nullable();
    t.timestamp('last_license_check_at', { useTz: true }).nullable();
  });

  await knex.schema.alterTable('companies', (t) => {
    t.enu('license_state', ['internal_free', 'trial', 'licensed', 'grace', 'expired'], {
      useNative: true,
      enumName: 'license_state',
    })
      .notNullable()
      .defaultTo('trial');
    t.timestamp('license_expires_at', { useTz: true }).nullable();
    t.text('license_key_encrypted').nullable();
    t.jsonb('license_claims').nullable();
    t.timestamp('license_issued_at', { useTz: true }).nullable();
    t.timestamp('last_license_check_at', { useTz: true }).nullable();
  });
  await knex('companies').where({ is_internal: true }).update({ license_state: 'internal_free' });
  await knex.raw('CREATE INDEX companies_license_state_idx ON companies (license_state)');
};
