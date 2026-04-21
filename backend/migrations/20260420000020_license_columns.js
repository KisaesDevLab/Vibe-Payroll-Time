// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Extra license columns on `companies`. The Phase 2 migration set up
 * license_state + license_expires_at; Phase 12 adds everything we need
 * to store, verify, and re-check a customer-uploaded JWT license.
 *
 * The raw JWT is stored encrypted at rest (same AES-GCM envelope as
 * Twilio / EmailIt / AI keys). Parsed claims live in `license_claims`
 * as JSONB for quick reads without decrypting.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('companies', (t) => {
    t.text('license_key_encrypted').nullable();
    t.jsonb('license_claims').nullable();
    t.timestamp('license_issued_at', { useTz: true }).nullable();
    t.timestamp('last_license_check_at', { useTz: true }).nullable();
  });

  await knex.raw(
    `CREATE INDEX companies_license_state_idx
     ON companies (license_state)`,
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS companies_license_state_idx');
  await knex.schema.alterTable('companies', (t) => {
    t.dropColumn('license_key_encrypted');
    t.dropColumn('license_claims');
    t.dropColumn('license_issued_at');
    t.dropColumn('last_license_check_at');
  });
};
