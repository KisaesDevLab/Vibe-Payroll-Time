/**
 * Phase 6.6 — Time-format preferences.
 *
 * User preference (`decimal` | `hhmm`) with company-level default
 * fallback. Both are display concerns; storage stays BIGINT seconds.
 *
 * `users.time_format_preference` is NULL-able — NULL means inherit from
 * company_settings. Explicit values override. A company_settings row
 * always exists (created with the company), so `company_settings.time_format_default`
 * is NOT NULL DEFAULT 'decimal'.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.enu('time_format_preference', ['decimal', 'hhmm'], {
      useNative: true,
      enumName: 'time_format_preference',
    }).nullable();
  });

  await knex.schema.alterTable('company_settings', (t) => {
    t.enu('time_format_default', ['decimal', 'hhmm'], {
      useNative: true,
      enumName: 'time_format_default',
    })
      .notNullable()
      .defaultTo('decimal');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('time_format_default');
  });
  await knex.raw(`DROP TYPE IF EXISTS time_format_default`);

  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('time_format_preference');
  });
  await knex.raw(`DROP TYPE IF EXISTS time_format_preference`);
};
