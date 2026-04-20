import type { CurrentPunchResponse } from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';
import { rowToTimeEntry, type TimeEntryRow } from './punch.js';

/**
 * Current-punch snapshot: open entry + today's running total.
 *
 * "Today" resolves in the company's timezone — Postgres' `date_trunc`
 * at AT TIME ZONE does the work server-side so we don't drag timezone
 * libraries into the query path.
 */
export async function getCurrentPunch(
  companyId: number,
  employeeId: number,
): Promise<CurrentPunchResponse> {
  const employee = await db('employees')
    .where({ id: employeeId, company_id: companyId })
    .first<{ id: number; first_name: string; last_name: string }>();
  if (!employee) throw NotFound('Employee not found');

  const openRow = await db<TimeEntryRow>('time_entries')
    .where({ company_id: companyId, employee_id: employeeId })
    .whereNull('ended_at')
    .whereNull('deleted_at')
    .first();

  const company = await db('companies')
    .where({ id: companyId })
    .first<{ timezone: string }>();
  const tz = company?.timezone ?? 'UTC';

  // Sum completed work entries that started today in the company's tz,
  // plus the time elapsed on an open work entry if any.
  const completedRow = await db('time_entries')
    .where({ company_id: companyId, employee_id: employeeId, entry_type: 'work' })
    .whereNull('deleted_at')
    .whereNotNull('ended_at')
    .whereRaw(
      `date_trunc('day', started_at AT TIME ZONE ?) = date_trunc('day', now() AT TIME ZONE ?)`,
      [tz, tz],
    )
    .sum<{ sum: string | null }>({ sum: 'duration_seconds' })
    .first();

  let todayWorkSeconds = Number(completedRow?.sum ?? 0);

  if (openRow && openRow.entry_type === 'work') {
    const openStartedToday = await db.raw(
      `SELECT date_trunc('day', ?::timestamptz AT TIME ZONE ?) =
              date_trunc('day', now() AT TIME ZONE ?) AS same_day`,
      [openRow.started_at, tz, tz],
    );
    const sameDay =
      openStartedToday.rows[0]?.same_day === true ||
      openStartedToday.rows[0]?.same_day === 't';
    if (sameDay) {
      todayWorkSeconds += Math.floor((Date.now() - openRow.started_at.getTime()) / 1000);
    }
  }

  return {
    employee: {
      id: employee.id,
      firstName: employee.first_name,
      lastName: employee.last_name,
    },
    openEntry: openRow ? rowToTimeEntry(openRow) : null,
    todayWorkSeconds,
  };
}
