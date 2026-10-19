// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Per-employee sign-in switch.
 *
 * `employees.login_disabled_at` (NULL = sign-in allowed, the default)
 * turns off the person's sign-in access to THIS company: web, personal-
 * device PWA, magic links and single sign-on. The employee record,
 * timesheets and kiosk punching are untouched; a kiosk identifies people
 * by PIN or badge, not by login.
 *
 * It is per company because one user can be an employee of several: off
 * at Acme leaves their access to Bob's alone. Someone whose every company
 * is switched off cannot sign in at all. SuperAdmins are never affected.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.timestamp('login_disabled_at', { useTz: true }).nullable();
    t.bigInteger('login_disabled_by')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('login_disabled_by');
    t.dropColumn('login_disabled_at');
  });
};
