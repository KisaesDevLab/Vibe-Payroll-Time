/**
 * AI configuration on company_settings.
 *
 * `ai_enabled` is the hard switch — when false, no provider call is
 * ever made regardless of credentials. Provider + API key live
 * here (key AES-GCM-encrypted like Twilio / EmailIt); the
 * appliance-wide env fallback covers companies without their own
 * key.
 *
 * `ai_daily_correction_limit` supports the per-employee NL-correction
 * budget from the build plan (default 20/day).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.boolean('ai_enabled').notNullable().defaultTo(false);
    t.string('ai_provider', 32).notNullable().defaultTo('anthropic');
    t.string('ai_model', 128).nullable();
    t.text('ai_api_key_encrypted').nullable();
    /** Optional base URL override for OpenAI-compat / Ollama backends. */
    t.string('ai_base_url', 512).nullable();
    t.smallint('ai_daily_correction_limit').notNullable().defaultTo(20);
  });

  await knex.schema.createTable('ai_token_usage', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.bigInteger('user_id')
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    t.string('feature', 32).notNullable(); // 'nl_correction' | 'support_chat'
    t.string('provider', 32).notNullable();
    t.string('model', 128).nullable();
    t.integer('prompt_tokens').notNullable().defaultTo(0);
    t.integer('completion_tokens').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(
    `CREATE INDEX ai_token_usage_company_created_idx
     ON ai_token_usage (company_id, created_at DESC)`,
  );

  await knex.schema.createTable('ai_correction_usage', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.bigInteger('employee_id')
      .notNullable()
      .references('id')
      .inTable('employees')
      .onDelete('CASCADE');
    t.date('day').notNullable();
    t.integer('count').notNullable().defaultTo(0);

    t.unique(['company_id', 'employee_id', 'day']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('ai_correction_usage');
  await knex.schema.dropTable('ai_token_usage');
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('ai_enabled');
    t.dropColumn('ai_provider');
    t.dropColumn('ai_model');
    t.dropColumn('ai_api_key_encrypted');
    t.dropColumn('ai_base_url');
    t.dropColumn('ai_daily_correction_limit');
  });
};
