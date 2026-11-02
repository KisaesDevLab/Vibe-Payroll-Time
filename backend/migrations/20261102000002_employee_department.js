// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * `employees.department`: optional free-text department (e.g. "Tax",
 * "Admin"). Reports group and subtotal by it; NULL lands in "No
 * department". Free text rather than a lookup table keeps it a label,
 * not a structure: the employee form suggests the departments already in
 * use, and reports group case-insensitively.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.string('department', 100).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('department');
  });
};
