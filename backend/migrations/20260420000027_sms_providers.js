/**
 * SMS provider choice + TextLinkSMS support.
 *
 * Before: Twilio-only, per-company. There was no appliance-wide SMS
 * fallback (unlike email, where appliance EmailIt filled in for
 * companies that hadn't set their own).
 *
 * After:
 *   appliance_settings
 *     sms_provider                 'twilio' | 'textlinksms' | null
 *     twilio_account_sid, twilio_auth_token_encrypted, twilio_from_number
 *     textlinksms_api_key_encrypted, textlinksms_from_number, textlinksms_base_url
 *
 *   company_settings
 *     sms_provider                 null = inherit from appliance
 *     textlinksms_api_key_encrypted, textlinksms_from_number
 *
 * Resolution rule in services/notifications/service.ts:
 *   - effective provider: company.sms_provider ?? appliance.sms_provider
 *   - effective creds:    company creds for that provider if complete,
 *                         else appliance creds for that provider if complete,
 *                         else null (SMS silently disabled)
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.string('sms_provider', 16).nullable();
    t.string('twilio_account_sid', 64).nullable();
    t.text('twilio_auth_token_encrypted').nullable();
    t.string('twilio_from_number', 32).nullable();
    t.text('textlinksms_api_key_encrypted').nullable();
    t.string('textlinksms_from_number', 32).nullable();
    t.string('textlinksms_base_url', 512).nullable();
  });

  await knex.schema.alterTable('company_settings', (t) => {
    // Null means "inherit the appliance-level provider". Explicit
    // 'twilio' / 'textlinksms' overrides even when the company has no
    // creds (forces fall-through to appliance creds for that provider).
    t.string('sms_provider', 16).nullable();
    t.text('textlinksms_api_key_encrypted').nullable();
    t.string('textlinksms_from_number', 32).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('sms_provider');
    t.dropColumn('textlinksms_api_key_encrypted');
    t.dropColumn('textlinksms_from_number');
  });
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.dropColumn('sms_provider');
    t.dropColumn('twilio_account_sid');
    t.dropColumn('twilio_auth_token_encrypted');
    t.dropColumn('twilio_from_number');
    t.dropColumn('textlinksms_api_key_encrypted');
    t.dropColumn('textlinksms_from_number');
    t.dropColumn('textlinksms_base_url');
  });
};
