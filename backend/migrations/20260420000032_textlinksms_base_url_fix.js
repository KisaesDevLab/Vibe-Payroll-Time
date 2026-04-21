/**
 * An earlier textlinksms client had the wrong default base URL hardcoded
 * (`https://app.textlinksms.com/api/v1`). If an operator saved that
 * value explicitly into `appliance_settings.textlinksms_base_url` or
 * `company_settings.textlinksms_base_url`, the subsequent client fix —
 * which now builds `{base}/api/send-sms` — would produce nonsense like
 * `https://app.textlinksms.com/api/v1/api/send-sms`.
 *
 * Null the stale value out so the new default (`https://textlinksms.com`)
 * kicks in. Any legitimately-custom base URL (e.g. a self-hosted fork)
 * survives unchanged.
 */
exports.up = async function up(knex) {
  // Only appliance_settings has this column — see the Phase 4.5 SMS
  // providers migration.
  await knex('appliance_settings')
    .where({ textlinksms_base_url: 'https://app.textlinksms.com/api/v1' })
    .update({ textlinksms_base_url: null });
};

exports.down = async function down() {
  // Intentional no-op. Rolling forward and back should not re-stamp an
  // incorrect URL into operator data.
};
