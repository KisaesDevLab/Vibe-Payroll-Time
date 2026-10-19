// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Indexes for lookups that run on every request or every poll.
 *
 *   employees (user_id, company_id)
 *       "which employee am I here?": the sign-in switch check on every
 *       company-scoped request, personal-device punches, open shifts.
 *       Only (company_id, status) was indexed.
 *   time_entries (company_id, employee_id, ended_at DESC) live rows
 *       the punch page's "previous event" lookup orders by ended_at and
 *       runs on every 30-second poll from every open phone.
 *   notifications_log (company_id, recipient_id, type, queued_at)
 *       the missed-punch sweep's "reminded recently?" check per open
 *       entry; only (company_id, queued_at) existed.
 *
 * Small tables on an appliance, so plain CREATE INDEX inside the
 * migration transaction is fine.
 */
exports.up = async function up(knex) {
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS employees_user_company_idx ON employees (user_id, company_id)',
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS time_entries_employee_ended_idx
       ON time_entries (company_id, employee_id, ended_at DESC)
       WHERE deleted_at IS NULL AND superseded_by_entry_id IS NULL`,
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS notifications_log_recipient_type_idx
       ON notifications_log (company_id, recipient_id, type, queued_at)`,
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS notifications_log_recipient_type_idx');
  await knex.raw('DROP INDEX IF EXISTS time_entries_employee_ended_idx');
  await knex.raw('DROP INDEX IF EXISTS employees_user_company_idx');
};
