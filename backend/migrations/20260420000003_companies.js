/**
 * Companies. One appliance hosts many companies. `is_internal = true` marks
 * the firm's own staff-only company (free tier, never licensed). Everything
 * else is a client-portal company subject to commercial licensing.
 *
 * License state is tracked per-company. `pay_period_type` and
 * `week_start_day` drive all pay-period and OT math.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('companies', (t) => {
    t.bigIncrements('id').primary();
    t.string('name', 200).notNullable();
    t.string('slug', 64).notNullable().unique();
    t.string('timezone', 64).notNullable();
    // 0 = Sunday, 6 = Saturday. Matches JS Date.getDay().
    t.smallint('week_start_day').notNullable().defaultTo(0);
    t.enu('pay_period_type', ['weekly', 'bi_weekly', 'semi_monthly', 'monthly'], {
      useNative: true,
      enumName: 'pay_period_type',
    })
      .notNullable()
      .defaultTo('bi_weekly');
    // Anchor used by bi_weekly pay periods. Null for other types.
    t.date('pay_period_anchor').nullable();
    t.boolean('is_internal').notNullable().defaultTo(false);
    t.enu(
      'license_state',
      ['internal_free', 'trial', 'licensed', 'grace', 'expired'],
      { useNative: true, enumName: 'license_state' },
    )
      .notNullable()
      .defaultTo('trial');
    t.timestamp('license_expires_at', { useTz: true }).nullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('disabled_at', { useTz: true }).nullable();
  });

  await knex.raw(
    'CREATE INDEX companies_active_idx ON companies (disabled_at) WHERE disabled_at IS NULL',
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('companies');
  await knex.raw('DROP TYPE IF EXISTS pay_period_type');
  await knex.raw('DROP TYPE IF EXISTS license_state');
};
