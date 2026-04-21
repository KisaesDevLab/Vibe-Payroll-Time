/**
 * SuperAdmin-editable display name ("custom brand name") for the
 * appliance. Null means fall back to the product default
 * ("Vibe Payroll Time").
 *
 * Exposed both in the admin settings API (for editing) and in the
 * public /appliance/info endpoint (so the login page can render the
 * custom name before anyone authenticates).
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.string('display_name', 80).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('appliance_settings', (t) => {
    t.dropColumn('display_name');
  });
};
