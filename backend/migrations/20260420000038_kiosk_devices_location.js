// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Phase 14.3 — `kiosk_devices.location_label` lets the operator
 * record a free-text label for a paired tablet ("Front Counter",
 * "Warehouse Bay 2") that the kiosk URL embeds as the `?location=<id>`
 * query parameter.
 *
 * The query parameter value is just the kiosk_devices.id; the label
 * is for the admin "Kiosk URL (use for tablets)" UI in §5.3 of the
 * compatibility addendum so a customer with multiple kiosks can tell
 * them apart at a glance.
 *
 * Nullable. Existing kiosks get NULL — they keep working at the
 * unchanged URL since the location parameter is optional.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('kiosk_devices', (t) => {
    t.string('location_label', 80).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('kiosk_devices', (t) => {
    t.dropColumn('location_label');
  });
};
