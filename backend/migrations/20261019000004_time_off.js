// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Time-off recording (ADDENDUM_TIME_OFF.md): PTO, sick, holiday and
 * unpaid leave are job codes with a flag, entered through the existing
 * manual-entry path. No accruals, no balances, no request workflow.
 *
 * `jobs` gains:
 *   is_time_off        the code records paid-but-not-worked (or unpaid)
 *                      time, not work. Never counts toward FLSA overtime.
 *   time_off_category  pto | sick | holiday | unpaid | other. Enforced in
 *                      the service, not the DB, so firms can grow it.
 *   is_paid            false for unpaid leave: logged for attendance,
 *                      left out of vendor payroll exports.
 *
 * `company_settings.time_off_self_entry` decides whether employees may
 * record their own time off (default true). It is separate from
 * `employee_manual_entry_mode`, which governs corrections to worked
 * time: a day off has no punch to override.
 *
 * Nothing is seeded. Each company turns the time-off types it uses on
 * under Settings → Time off; existing companies see no change.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.boolean('is_time_off').notNullable().defaultTo(false);
    t.string('time_off_category', 32).nullable();
    t.boolean('is_paid').notNullable().defaultTo(true);
  });
  await knex.raw(
    `ALTER TABLE jobs ADD CONSTRAINT jobs_time_off_category_chk
       CHECK (is_time_off = false OR time_off_category IS NOT NULL)`,
  );
  await knex.schema.alterTable('company_settings', (t) => {
    t.boolean('time_off_self_entry').notNullable().defaultTo(true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('time_off_self_entry');
  });
  await knex.raw('ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_time_off_category_chk');
  await knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('is_paid');
    t.dropColumn('time_off_category');
    t.dropColumn('is_time_off');
  });
};
