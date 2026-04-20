/**
 * Singleton `appliance_settings` table. Holds appliance-wide defaults and
 * global feature flags. Exactly one row exists; schema uses a CHECK
 * constraint to enforce that.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('appliance_settings', (t) => {
    t.smallint('id').primary().defaultTo(1);
    t.check('?? = 1', ['id'], 'appliance_settings_singleton');
    t.string('installation_id', 64).notNullable();
    t.string('timezone_default', 64).notNullable().defaultTo('America/Chicago');
    t.jsonb('feature_flags').notNullable().defaultTo('{}');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  // Pre-populate the singleton row. installation_id is a placeholder — the
  // setup wizard overwrites it with gen_random_uuid() on first run.
  await knex('appliance_settings').insert({
    id: 1,
    installation_id: 'pending-setup',
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('appliance_settings');
};
