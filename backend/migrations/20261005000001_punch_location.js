// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Opt-in punch location capture.
 *
 * `company_settings.punch_location_mode` (off | optional | required),
 * default `off`. When it is on, the personal-device PWA asks the browser
 * for a GPS fix at the moment of each punch and sends it with the
 * request. Nothing is ever recorded between punches, and the server
 * never rejects or alters a punch because of its location — this is
 * attribution, like `source_ip`, not geofencing.
 *
 * `time_entries` gains two coordinate pairs because one row carries both
 * the punch that opened it and the punch that closed it:
 *
 *   started_lat / started_lng / started_accuracy_m / started_location_status
 *   ended_lat   / ended_lng   / ended_accuracy_m   / ended_location_status
 *
 * Coordinates are decimal(9,6) — about 11 cm of precision, more than any
 * phone delivers. `*_accuracy_m` is the browser-reported 95% radius.
 *
 * `*_location_status` records what happened when the client was asked:
 *   captured     coordinates present
 *   denied       the employee refused the browser permission prompt
 *   unavailable  the device could not produce a fix (no GPS, timeout)
 *   missing      the company mode was on but the client sent nothing
 *   NULL         location was not requested (mode off, kiosk, admin,
 *                cron, or a row that predates this migration)
 *
 * All columns nullable; existing rows stay NULL.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.enu('punch_location_mode', ['off', 'optional', 'required'], {
      useNative: true,
      enumName: 'punch_location_mode',
    })
      .notNullable()
      .defaultTo('off');
  });

  await knex.schema.alterTable('time_entries', (t) => {
    t.decimal('started_lat', 9, 6).nullable();
    t.decimal('started_lng', 9, 6).nullable();
    t.integer('started_accuracy_m').nullable();
    t.string('started_location_status', 16).nullable();
    t.decimal('ended_lat', 9, 6).nullable();
    t.decimal('ended_lng', 9, 6).nullable();
    t.integer('ended_accuracy_m').nullable();
    t.string('ended_location_status', 16).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('time_entries', (t) => {
    t.dropColumn('started_lat');
    t.dropColumn('started_lng');
    t.dropColumn('started_accuracy_m');
    t.dropColumn('started_location_status');
    t.dropColumn('ended_lat');
    t.dropColumn('ended_lng');
    t.dropColumn('ended_accuracy_m');
    t.dropColumn('ended_location_status');
  });
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('punch_location_mode');
  });
  await knex.raw('DROP TYPE IF EXISTS punch_location_mode');
};
