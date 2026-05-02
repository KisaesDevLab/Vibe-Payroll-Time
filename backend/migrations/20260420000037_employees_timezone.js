// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Phase 14.2 — per-employee timezone override. Companies serving
 * multi-state customers (a small landscaping firm with one foreman
 * working out of Eastern and crews working in Central) need a way to
 * override the company timezone on a per-employee basis without
 * splitting the firm into two tenants.
 *
 * Nullable. NULL falls back to `companies.timezone` at display time —
 * that path is the pre-Phase-14 default and is what every existing
 * employee gets after this migration runs. No backfill needed.
 *
 * IANA tz strings only (e.g. "America/Chicago"); the schema doesn't
 * validate but the API surface clamps to a known set before write.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.string('timezone', 64).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('timezone');
  });
};
