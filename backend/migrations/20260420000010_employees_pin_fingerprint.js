/**
 * Add `pin_fingerprint` — a deterministic HMAC-SHA256 of the PIN keyed by
 * a value derived from SECRETS_ENCRYPTION_KEY (see services/crypto.ts).
 *
 * Why two columns?
 *   - `pin_hash` is bcrypt, with per-row salt. Two employees with the same
 *     PIN produce different bcrypt hashes, so it can't back a uniqueness
 *     constraint — and can't back a kiosk PIN lookup either (we'd need
 *     N bcrypt verifies per punch).
 *   - `pin_fingerprint` is deterministic, keyed with a server-only secret.
 *     Equal PINs → equal fingerprint, so (a) a partial unique index
 *     enforces no PIN collisions within an active roster, and (b) kiosk
 *     punch can find the employee with a single indexed lookup.
 *
 * bcrypt still guards against a DB-only dump (HMAC key would have to leak
 * for a fingerprint to be reversed, and even then an attacker would still
 * face 10^4–10^6 PIN guesses per employee against bcrypt).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.string('pin_fingerprint', 64).nullable();
  });

  // Replace the pin_hash-based uniqueness index with one on pin_fingerprint.
  await knex.raw('DROP INDEX IF EXISTS employees_active_pin_unique_idx');
  await knex.raw(
    `CREATE UNIQUE INDEX employees_active_pin_fingerprint_unique_idx
     ON employees (company_id, pin_fingerprint)
     WHERE status = 'active' AND pin_fingerprint IS NOT NULL`,
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS employees_active_pin_fingerprint_unique_idx');
  await knex.raw(
    `CREATE UNIQUE INDEX employees_active_pin_unique_idx
     ON employees (company_id, pin_hash)
     WHERE status = 'active' AND pin_hash IS NOT NULL`,
  );
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('pin_fingerprint');
  });
};
