// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Missing-time reminders: nudge employees who have expected work days
 * with no time recorded in a pay period.
 *
 * company_settings
 *   missing_time_reminders_enabled  Automatic reminders after a pay
 *                                   period ends. Off by default; the
 *                                   manual "Send reminders" button works
 *                                   either way.
 *   work_days                       Expected weekdays, 0 = Sunday .. 6 =
 *                                   Saturday. Default Mon–Fri.
 *   missing_time_reminder_hour      Company-local hour (0–23) the daily
 *                                   reminder goes out.
 *   missing_time_reminder_max       Automatic reminders per employee per
 *                                   pay period.
 *
 * employees
 *   work_days                       Per-employee override of the company
 *                                   work days; NULL = company default.
 *   missing_time_reminders_enabled  Admin switch to leave someone out.
 *
 * missing_time_reminders            One row per reminder sent (employee)
 *                                   or per manager summary. Drives the
 *                                   once-a-day rule and the cap; the
 *                                   partial unique index makes an
 *                                   automatic send idempotent if the
 *                                   sweep runs twice in the same hour.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.boolean('missing_time_reminders_enabled').notNullable().defaultTo(false);
    t.specificType('work_days', 'smallint[]').notNullable().defaultTo('{1,2,3,4,5}');
    t.smallint('missing_time_reminder_hour').notNullable().defaultTo(9);
    t.smallint('missing_time_reminder_max').notNullable().defaultTo(3);
  });
  await knex.raw(`
    ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_missing_time_reminder_hour_check
        CHECK (missing_time_reminder_hour BETWEEN 0 AND 23),
      ADD CONSTRAINT company_settings_missing_time_reminder_max_check
        CHECK (missing_time_reminder_max BETWEEN 1 AND 10),
      ADD CONSTRAINT company_settings_work_days_check
        CHECK (work_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
  `);

  await knex.schema.alterTable('employees', (t) => {
    t.specificType('work_days', 'smallint[]').nullable();
    t.boolean('missing_time_reminders_enabled').notNullable().defaultTo(true);
  });
  await knex.raw(`
    ALTER TABLE employees
      ADD CONSTRAINT employees_work_days_check
        CHECK (work_days IS NULL OR work_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
  `);

  await knex.schema.createTable('missing_time_reminders', (t) => {
    t.bigIncrements('id').primary();
    t.bigInteger('company_id')
      .notNullable()
      .references('id')
      .inTable('companies')
      .onDelete('CASCADE');
    // NULL on a manager summary.
    t.bigInteger('employee_id')
      .nullable()
      .references('id')
      .inTable('employees')
      .onDelete('CASCADE');
    t.enu('kind', ['employee', 'summary'], {
      useNative: true,
      enumName: 'missing_time_reminder_kind',
    }).notNullable();
    t.enu('trigger', ['auto', 'manual'], {
      useNative: true,
      enumName: 'missing_time_reminder_trigger',
    }).notNullable();
    // The pay period reminded about, as company-local calendar days
    // (end inclusive).
    t.date('period_start').notNullable();
    t.date('period_end').notNullable();
    // Company-local day the reminder went out — the once-a-day key.
    t.date('local_date').notNullable();
    t.jsonb('missing_dates').notNullable().defaultTo('[]');
    t.bigInteger('sent_by').nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['company_id', 'period_start'], 'missing_time_reminders_company_period_idx');
  });
  await knex.raw(`
    CREATE UNIQUE INDEX missing_time_reminders_auto_daily_uniq
      ON missing_time_reminders (company_id, COALESCE(employee_id, 0), kind, period_start, local_date)
      WHERE trigger = 'auto'
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('missing_time_reminders');
  await knex.raw('DROP TYPE IF EXISTS missing_time_reminder_kind');
  await knex.raw('DROP TYPE IF EXISTS missing_time_reminder_trigger');
  await knex.raw('ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_work_days_check');
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('work_days');
    t.dropColumn('missing_time_reminders_enabled');
  });
  await knex.raw(`
    ALTER TABLE company_settings
      DROP CONSTRAINT IF EXISTS company_settings_missing_time_reminder_hour_check,
      DROP CONSTRAINT IF EXISTS company_settings_missing_time_reminder_max_check,
      DROP CONSTRAINT IF EXISTS company_settings_work_days_check
  `);
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('missing_time_reminders_enabled');
    t.dropColumn('work_days');
    t.dropColumn('missing_time_reminder_hour');
    t.dropColumn('missing_time_reminder_max');
  });
};
