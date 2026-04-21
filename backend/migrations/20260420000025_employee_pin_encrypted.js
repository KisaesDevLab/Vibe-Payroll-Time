/**
 * Store employee PINs encrypted-at-rest alongside the bcrypt hash +
 * HMAC fingerprint, so company admins can view the PIN they need to
 * read out to an employee.
 *
 *   pin_hash          — bcrypt hash, used to VERIFY a kiosk PIN entry.
 *   pin_fingerprint   — HMAC for O(1) lookup by (company_id, fingerprint).
 *   pin_encrypted     — NEW: AES-256-GCM envelope (same shape as
 *                       Twilio/EmailIt/AI keys), decrypted for display
 *                       to company_admins + supervisors only.
 *
 * Tradeoff deliberately chosen: a 4–6 digit PIN is a low-value secret
 * in a workplace time-tracking app (buddy-punching is already caught
 * by the audit trail + IP logging). The practical UX win for admins
 * outweighs the hash-vs-encrypted downgrade, and the same DB already
 * holds higher-value secrets under the same envelope.
 *
 * Employees whose PIN was set before this migration have no
 * pin_encrypted value. The UI shows "—" for them until they're
 * regenerated or set manually.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.text('pin_encrypted').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('pin_encrypted');
  });
};
