// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Move licensing from per-company to appliance-wide.
 *
 * The commercial model Vibe PT actually ships under is "one CPA firm
 * buys one appliance, licenses cover every company on it" — the earlier
 * per-company columns made sense for a world where each tenant paid
 * separately, but in practice that isn't how these deployments work.
 *
 * Columns added here mirror the ones the companies table already has
 * (same types, same semantics) so the service layer can reuse the
 * existing computeState() logic unchanged — the only thing that
 * changes is WHICH row it reads from.
 *
 * The per-company columns on `companies` are intentionally left in
 * place for one release so legacy data isn't lost; the service layer
 * stops reading them. A follow-up migration can drop them once
 * operators have migrated.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.text('license_key_encrypted').nullable();
    t.jsonb('license_claims').nullable();
    // Diagnostic copy of the derived state — the authoritative value is
    // still recomputed from claims/expires_at/created_at by computeState.
    t.string('license_state', 16).nullable();
    t.timestamp('license_issued_at', { useTz: true }).nullable();
    t.timestamp('license_expires_at', { useTz: true }).nullable();
    t.timestamp('last_license_check_at', { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.dropColumn('license_key_encrypted');
    t.dropColumn('license_claims');
    t.dropColumn('license_state');
    t.dropColumn('license_issued_at');
    t.dropColumn('license_expires_at');
    t.dropColumn('last_license_check_at');
  });
};
