// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Access groups: how a SuperAdmin grants the firm's staff access to
 * companies in bulk.
 *
 *   access_groups           — a named group ("Audit team")
 *   access_group_members    — which users are in it
 *   access_group_companies  — which companies it grants, with which role
 *
 * Authorization keeps reading `company_memberships` and nothing else: a
 * group's grants are MATERIALIZED there as rows with
 * `granted_by_group = true`, maintained by services/access-groups.ts
 * (`reconcileGroupAccess`). A user in several groups that grant the same
 * company gets the highest role. A direct membership (granted_by_group =
 * false, the existing kind) is never touched by a group and takes
 * precedence over it for that company.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('access_groups', (t) => {
    t.bigIncrements('id').primary();
    t.string('name', 100).notNullable().unique();
    t.text('description').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('access_group_members', (t) => {
    t.bigInteger('group_id')
      .notNullable()
      .references('id')
      .inTable('access_groups')
      .onDelete('CASCADE');
    t.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['group_id', 'user_id']);
  });
  await knex.raw('CREATE INDEX access_group_members_user_idx ON access_group_members (user_id)');

  await knex.schema.createTable('access_group_companies', (t) => {
    t.bigInteger('group_id')
      .notNullable()
      .references('id')
      .inTable('access_groups')
      .onDelete('CASCADE');
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    // Reuses the native `company_role` enum from company_memberships.
    t.specificType('role', 'company_role').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.primary(['group_id', 'company_id']);
  });

  await knex.schema.alterTable('company_memberships', (t) => {
    t.boolean('granted_by_group').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  // Group-granted rows exist only because of the groups being dropped.
  await knex('company_memberships').where({ granted_by_group: true }).delete();
  await knex.schema.alterTable('company_memberships', (t) => {
    t.dropColumn('granted_by_group');
  });
  await knex.schema.dropTable('access_group_companies');
  await knex.schema.dropTable('access_group_members');
  await knex.schema.dropTable('access_groups');
};
