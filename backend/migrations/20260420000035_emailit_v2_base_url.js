/**
 * An earlier EmailIt client shipped with `https://api.emailit.com/v1`
 * as both the hardcoded default and the placeholder in the admin UI.
 * The live API has since moved to `/v2`, and v1 returns 404 /
 * "endpoint gone" on every send attempt.
 *
 * If an operator saved the v1 URL into `appliance_settings.emailit_api_base_url`
 * explicitly (either by typing it or by letting the UI pre-fill the
 * placeholder and hitting Save), every email send since then has
 * silently failed. Null the stale value out so the new default
 * (`https://api.emailit.com/v2`) kicks in. Any legitimately-custom
 * base URL (self-hosted fork, staging host) survives unchanged.
 *
 * Mirrors the same pattern used for TextLinkSMS in migration 32.
 */
exports.up = async function up(knex) {
  await knex('appliance_settings')
    .where({ emailit_api_base_url: 'https://api.emailit.com/v1' })
    .update({ emailit_api_base_url: null });
};

exports.down = async function down() {
  // Intentional no-op — rolling forward/back should not re-stamp an
  // incorrect URL into operator data.
};
