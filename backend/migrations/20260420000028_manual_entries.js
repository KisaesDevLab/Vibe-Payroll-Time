/**
 * Phase 6.5 — Manual time-entry engine.
 *
 * Storage additions (all on `time_entries`):
 *   - `source` enum gains `web_manual`. Existing enum values left
 *     untouched; expanding is additive and safe.
 *   - `entry_reason` text — mandatory at the service layer when source
 *     is `web_manual`.
 *   - `superseded_by_entry_id` — the manual entry that replaced this
 *     one. Original punches are preserved forever for audit; they just
 *     fall out of the "active" view.
 *   - `supersedes_entry_ids` BIGINT[] — array on the manual entry
 *     listing the punches it replaced. Denormalized because we need to
 *     restore those specific rows on manual-entry delete.
 *   - `is_manual` GENERATED column — fast `WHERE is_manual` without
 *     having to peek at enum text.
 *
 * Audit action enum (`time_entry_audit_action`) picks up
 * `manual_create`, `manual_update`, `manual_delete`, `manual_override`,
 * `manual_revert` for the new flows.
 *
 * `company_settings` gets two new toggles to let a firm restrict who
 * may originate manual entries.
 */
// Postgres does not allow a newly-added enum value to be referenced in
// the same transaction that added it. We have to run this whole
// migration without Knex's default per-migration transaction; the
// individual DDL statements are still atomic on their own.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  // 1) Expand source enum.
  await knex.raw(`ALTER TYPE time_entry_source ADD VALUE IF NOT EXISTS 'web_manual'`);

  // 2) Expand audit-action enum.
  await knex.raw(`ALTER TYPE time_entry_audit_action ADD VALUE IF NOT EXISTS 'manual_create'`);
  await knex.raw(`ALTER TYPE time_entry_audit_action ADD VALUE IF NOT EXISTS 'manual_update'`);
  await knex.raw(`ALTER TYPE time_entry_audit_action ADD VALUE IF NOT EXISTS 'manual_delete'`);
  await knex.raw(`ALTER TYPE time_entry_audit_action ADD VALUE IF NOT EXISTS 'manual_override'`);
  await knex.raw(`ALTER TYPE time_entry_audit_action ADD VALUE IF NOT EXISTS 'manual_revert'`);

  // 3) Add columns.
  await knex.schema.alterTable('time_entries', (t) => {
    t.text('entry_reason').nullable();
    t.bigInteger('superseded_by_entry_id')
      .nullable()
      .references('id')
      .inTable('time_entries')
      .onDelete('SET NULL');
    // Raw knex.specificType to get a BIGINT[] array column.
    t.specificType('supersedes_entry_ids', 'BIGINT[]').nullable();
  });

  // 4) GENERATED column for fast source-filter. Postgres expects the
  //    generated expression as-is; knex doesn't have first-class support.
  await knex.raw(
    `ALTER TABLE time_entries
     ADD COLUMN is_manual BOOLEAN GENERATED ALWAYS AS (source = 'web_manual') STORED`,
  );

  // 5) Indexes — "active" view (non-superseded), and fast lookup by the
  //    superseding entry on delete (to restore).
  await knex.raw(
    `CREATE INDEX time_entries_active_idx
     ON time_entries (company_id, employee_id, started_at)
     WHERE superseded_by_entry_id IS NULL AND deleted_at IS NULL`,
  );
  await knex.raw(
    `CREATE INDEX time_entries_superseded_by_idx
     ON time_entries (superseded_by_entry_id)
     WHERE superseded_by_entry_id IS NOT NULL`,
  );

  // 6) Partial unique: one non-superseded, non-deleted manual entry per
  //    (employee, company-local day, job). `day` is the calendar day in
  //    the company's timezone derived via started_at::date-in-tz at
  //    insert time; we enforce at the service layer using
  //    date_trunc('day', started_at AT TIME ZONE <tz>). The index uses
  //    `started_at::date` over UTC as a proxy — the service layer
  //    aligns started_at to local-midnight-in-tz so the two agree.
  await knex.raw(
    `CREATE UNIQUE INDEX time_entries_manual_unique_per_day_job
     ON time_entries (employee_id, ((started_at AT TIME ZONE 'UTC')::date), COALESCE(job_id, -1))
     WHERE source = 'web_manual'
       AND superseded_by_entry_id IS NULL
       AND deleted_at IS NULL`,
  );

  // 7) company_settings toggles.
  await knex.schema.alterTable('company_settings', (t) => {
    t.enu('employee_manual_entry_mode', ['allowed', 'override_only', 'disabled'], {
      useNative: true,
      enumName: 'employee_manual_entry_mode',
    })
      .notNullable()
      .defaultTo('allowed');
    t.boolean('manual_entry_requires_approval').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('company_settings', (t) => {
    t.dropColumn('manual_entry_requires_approval');
    t.dropColumn('employee_manual_entry_mode');
  });
  await knex.raw(`DROP TYPE IF EXISTS employee_manual_entry_mode`);

  await knex.raw(`DROP INDEX IF EXISTS time_entries_manual_unique_per_day_job`);
  await knex.raw(`DROP INDEX IF EXISTS time_entries_superseded_by_idx`);
  await knex.raw(`DROP INDEX IF EXISTS time_entries_active_idx`);

  await knex.schema.alterTable('time_entries', (t) => {
    t.dropColumn('is_manual');
    t.dropColumn('supersedes_entry_ids');
    t.dropColumn('superseded_by_entry_id');
    t.dropColumn('entry_reason');
  });

  // Enum values cannot be removed in Postgres without recreating the
  // type. Leaving them in place is harmless; downgrade rolls back only
  // the columns and index.
};
