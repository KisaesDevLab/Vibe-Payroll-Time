/**
 * Refresh tokens. The actual token value is never stored — only a SHA-256
 * hash so a DB read doesn't leak live tokens. Each refresh rotates the token
 * (atomic: mark the old one revoked, issue a new row). Revocation is
 * either explicit (logout) or implicit on rotation.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // hex-encoded SHA-256 digest of the token.
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true }).nullable();
    // Link a rotated-away token to its successor for audit/forensics.
    t.bigInteger('replaced_by_id').nullable();
    t.string('user_agent', 512).nullable();
    t.string('ip', 64).nullable();
  });

  await knex.raw(
    `CREATE INDEX refresh_tokens_active_idx
     ON refresh_tokens (user_id)
     WHERE revoked_at IS NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('refresh_tokens');
};
