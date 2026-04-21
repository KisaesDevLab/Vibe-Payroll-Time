/**
 * Cloudflare Tunnel runtime state on `appliance_settings`.
 *
 * The token itself is NOT stored in the DB — it's written to `.env` on
 * the host by `tunnel-from-request.sh` (triggered via the shared
 * update-control volume) and the sidecar reads it from there. Storing
 * the token in the DB would be a second copy that could drift from the
 * running process's env.
 *
 * What we DO store:
 *   - enabled flag (SuperAdmin toggle)
 *   - token_set boolean (so the UI can render "configured" vs "no token")
 *   - last_applied_at / last_error so the UI can surface the last
 *     apply result without tailing logs.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.boolean('cloudflare_tunnel_enabled').notNullable().defaultTo(false);
    t.boolean('cloudflare_tunnel_token_set').notNullable().defaultTo(false);
    t.timestamp('cloudflare_tunnel_last_applied_at', { useTz: true }).nullable();
    t.text('cloudflare_tunnel_last_error').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.dropColumn('cloudflare_tunnel_last_error');
    t.dropColumn('cloudflare_tunnel_last_applied_at');
    t.dropColumn('cloudflare_tunnel_token_set');
    t.dropColumn('cloudflare_tunnel_enabled');
  });
};
