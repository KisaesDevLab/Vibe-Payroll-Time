/**
 * `company_memberships` links users to companies with a role. One user may
 * belong to many companies (e.g., a CPA firm supervisor who's also an admin
 * on a client's company). `(user_id, company_id)` is unique.
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('company_memberships', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    t.enu('role', ['company_admin', 'supervisor', 'employee'], {
      useNative: true,
      enumName: 'company_role',
    }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    t.unique(['user_id', 'company_id']);
  });

  await knex.raw(
    'CREATE INDEX company_memberships_company_idx ON company_memberships (company_id)',
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('company_memberships');
  await knex.raw('DROP TYPE IF EXISTS company_role');
};
