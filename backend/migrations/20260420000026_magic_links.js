/**
 * Passwordless login via single-use emailed or texted token.
 *
 * The plaintext token (32 random bytes, base64url) is only returned in
 * the notification link — what we store here is its SHA-256 hash so a
 * DB dump alone can't log anyone in. `consumed_at` makes the token
 * single-use; `expires_at` enforces a 15-minute TTL at verify time.
 *
 *   user_id        set for every row — magic link requires an existing
 *                  appliance user account (users row). Employees
 *                  without a user account can't use magic link yet;
 *                  that needs a separate invite flow.
 *   channel        'email' | 'sms' — audit + which transport was used.
 *   identifier     The email or phone the link was delivered to, for
 *                  audit ("who requested this link").
 *   ip / user_agent Captured at request time so a consume coming from
 *                  a different IP can be flagged (future work).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('magic_links', (t) => {
    t.bigIncrements('id').primary();
    t.string('token_hash', 64).notNullable().unique();
    t.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('channel', 8).notNullable();
    t.string('identifier', 254).notNullable();
    t.string('ip', 64).nullable();
    t.string('user_agent', 512).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('consumed_at', { useTz: true }).nullable();
  });

  // Rate-limit lookup: "how many requests for this identifier in the
  // last hour?" plus the expire/consume sweep.
  await knex.raw(
    `CREATE INDEX magic_links_identifier_created_idx
     ON magic_links (identifier, created_at DESC)`,
  );
  await knex.raw(
    `CREATE INDEX magic_links_expires_idx
     ON magic_links (expires_at) WHERE consumed_at IS NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS magic_links_expires_idx');
  await knex.raw('DROP INDEX IF EXISTS magic_links_identifier_created_idx');
  await knex.schema.dropTable('magic_links');
};
