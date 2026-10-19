// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * `magic_links.company_id` — the client company an admin sent the link
 * from, when there was one.
 *
 * Under `oidc_only` a firm user signs in through the identity provider,
 * and links are refused for them. The one exception is a link a company
 * admin sends from a CLIENT company's Team or Employees page: a firm
 * person who also works for that client gets in that way. Consuming the
 * link re-checks that the company is still a client company and that the
 * person still belongs to it, which needs to know where the link came
 * from. NULL for self-service links and the appliance-wide People page.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('magic_links', (t) => {
    t.integer('company_id').nullable().references('id').inTable('companies').onDelete('SET NULL');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('magic_links', (t) => {
    t.dropColumn('company_id');
  });
};
