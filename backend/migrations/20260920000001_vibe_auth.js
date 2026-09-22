// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Vibe Auth (single sign-on) tables.
 *
 * The three package tables (auth_identities, auth_settings,
 * auth_revocations) come verbatim from @kisaesdevlab/vibe-auth's shipped
 * SQL so they stay in step with the package's query-backed stores.
 *
 * The rest is ours:
 *
 *   auth_sessions_oidc         Sessions here are stateless JWTs, so the
 *                              identity behind an SSO login (issuer,
 *                              subject, IdP session id, ID token for
 *                              RP-initiated logout) is parked here, keyed
 *                              by the `sid` claim the SSO access token
 *                              carries.
 *   refresh_tokens.sso_sid     Carries that `sid` across refresh-token
 *                              rotation so a refreshed access token is
 *                              still recognisably SSO-born.
 *   users.sso_provisioned_at   Set on just-in-time provisioned accounts.
 *                              While set, the account has no local
 *                              credential and the self-service magic-link
 *                              / password-reset paths refuse it — an SSO
 *                              account must not be able to bootstrap a
 *                              local password from its mailbox alone.
 */
const fs = require('fs');

function packageSql() {
  const file = require.resolve('@kisaesdevlab/vibe-auth/sql/auth_identities.sql');
  return fs.readFileSync(file, 'utf8');
}

exports.up = async function up(knex) {
  await knex.raw(packageSql());

  await knex.schema.createTable('auth_sessions_oidc', (t) => {
    t.string('sid', 64).primary();
    t.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('issuer').notNullable();
    t.text('subject').notNullable();
    t.text('oidc_sid').nullable();
    t.text('id_token').nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['user_id']);
    t.index(['issuer', 'subject']);
    t.index(['oidc_sid']);
  });

  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.string('sso_sid', 64).nullable();
  });

  await knex.schema.alterTable('users', (t) => {
    t.timestamp('sso_provisioned_at', { useTz: true }).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('sso_provisioned_at');
  });
  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.dropColumn('sso_sid');
  });
  await knex.schema.dropTableIfExists('auth_sessions_oidc');
  await knex.schema.dropTableIfExists('auth_revocations');
  await knex.schema.dropTableIfExists('auth_settings');
  await knex.schema.dropTableIfExists('auth_identities');
};
