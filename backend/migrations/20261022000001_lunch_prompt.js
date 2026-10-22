// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * `company_settings.lunch_prompt_enabled`: when on (the default), a
 * clock-out after a long unbroken stretch of work asks the employee about
 * lunch (30 / 60 minutes / worked through) and deducts it. Off restores
 * the plain clock-out.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.boolean('lunch_prompt_enabled').notNullable().defaultTo(true);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('lunch_prompt_enabled');
  });
};
