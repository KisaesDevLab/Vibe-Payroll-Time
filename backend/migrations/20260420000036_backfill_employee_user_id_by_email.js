// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Backfill `employees.user_id` for rows that were created with a
 * matching email but without a user_id link. Pre-fix, createEmployee
 * didn't look up `users` by email, so an admin who (a) invited someone
 * as a team member and (b) added the same person as an employee ended
 * up with an employees row carrying the email but user_id=NULL. The
 * downstream punch / timesheet endpoints all look up the employee by
 * `user_id`, so the employee effectively couldn't use the app despite
 * having both a user account and an employee record.
 *
 * Forward fix (createEmployee + updateEmployee + inviteMembership) lives
 * in the service layer. This migration repairs the existing data. It
 * is idempotent (re-running does nothing) and safe to run on any
 * appliance.
 *
 * Match criteria:
 *   - employees.email is non-null and case-insensitively matches a
 *     users.email
 *   - employees.user_id is NULL
 *   - the matched user is not disabled
 *
 * We do NOT constrain on status='active' — linking a terminated row to
 * its user is also correct (the user should see their old timesheet
 * if they re-authenticate; there's an existing isEmployee check at the
 * service layer that gates punch on status='active' separately).
 *
 * If two users ever share an email (shouldn't happen — users.email is
 * effectively unique via the citext / lower(email) index pattern, but
 * just in case), we pick the first user by id to keep behaviour
 * deterministic.
 */

exports.up = async function up(knex) {
  await knex.raw(`
    UPDATE employees e
       SET user_id = u.id,
           updated_at = NOW()
      FROM users u
     WHERE e.user_id IS NULL
       AND e.email IS NOT NULL
       AND LOWER(e.email) = LOWER(u.email)
       AND u.disabled_at IS NULL
       AND u.id = (
         SELECT MIN(u2.id) FROM users u2
          WHERE LOWER(u2.email) = LOWER(e.email)
            AND u2.disabled_at IS NULL
       )
  `);
};

exports.down = async function down() {
  // Intentional no-op: un-linking would put legitimate users right
  // back into the "cannot access employee time" state this migration
  // fixed. The forward-only policy in CLAUDE.md applies.
};
