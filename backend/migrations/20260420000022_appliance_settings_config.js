/**
 * Promote operator-facing appliance config out of .env and into the
 * singleton `appliance_settings` row so a SuperAdmin can edit it from
 * the UI without SSH'ing in.
 *
 * Resolution semantics (enforced in services/appliance-settings.ts):
 *   - Column is NOT NULL / NULL'd → value from DB wins.
 *   - Column is NULL → fall through to the matching process.env var.
 * This preserves the existing env-only boot path for fresh appliances
 * and CI overrides, while giving non-technical operators a UI for
 * everything they're likely to change (email provider, AI provider,
 * retention, log level).
 *
 * Secrets (EMAILIT_API_KEY, AI_API_KEY) are encrypted at rest with the
 * same AES-256-GCM envelope used for per-company secrets.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    // EmailIt appliance-wide fallback.
    t.text('emailit_api_key_encrypted').nullable();
    t.string('emailit_from_email', 254).nullable();
    t.string('emailit_from_name', 200).nullable();
    t.string('emailit_api_base_url', 512).nullable();

    // AI appliance-wide fallback. ai_provider mirrors the enum the env
    // var supports; validation happens at the service layer.
    t.string('ai_provider', 32).nullable();
    t.text('ai_api_key_encrypted').nullable();
    t.string('ai_model', 128).nullable();
    t.string('ai_base_url', 512).nullable();

    // pg_dump retention (days).
    t.smallint('retention_days').nullable();

    // Log level (pino-compatible strings). Changes apply live via the
    // settings service — no restart required.
    t.string('log_level', 16).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.dropColumn('emailit_api_key_encrypted');
    t.dropColumn('emailit_from_email');
    t.dropColumn('emailit_from_name');
    t.dropColumn('emailit_api_base_url');
    t.dropColumn('ai_provider');
    t.dropColumn('ai_api_key_encrypted');
    t.dropColumn('ai_model');
    t.dropColumn('ai_base_url');
    t.dropColumn('retention_days');
    t.dropColumn('log_level');
  });
};
