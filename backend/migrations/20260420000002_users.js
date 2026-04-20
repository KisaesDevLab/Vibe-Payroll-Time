/**
 * Appliance-level users. `role_global` is `super_admin` for accounts that
 * manage the appliance itself; `none` for everyone else (their permissions
 * are determined by per-company `company_memberships`).
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.bigIncrements('id').primary();
    t.string('email', 254).notNullable().unique();
    t.string('password_hash', 72).notNullable();
    t.enu('role_global', ['super_admin', 'none'], {
      useNative: true,
      enumName: 'user_role_global',
    })
      .notNullable()
      .defaultTo('none');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('last_login_at', { useTz: true }).nullable();
    t.timestamp('disabled_at', { useTz: true }).nullable();
  });

  await knex.raw(
    'CREATE INDEX users_disabled_idx ON users (disabled_at) WHERE disabled_at IS NULL',
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('users');
  await knex.raw('DROP TYPE IF EXISTS user_role_global');
};
