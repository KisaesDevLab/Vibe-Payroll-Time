// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { CurrentPunchResponse, OpenShift } from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';
import { getOpenEntry, getTodayWorkSeconds, rowToTimeEntry } from './punch.js';

/**
 * Current-punch snapshot: open entry + today's running total. Used by the
 * personal-device PWA landing page. Shares the clip-to-day seconds
 * calculation with the kiosk verify response via getTodayWorkSeconds, so
 * overnight shifts attribute correctly to each day on both surfaces.
 */
/**
 * The user's open entries across every company where they have an
 * employee record — a person in two companies has two employee rows, and
 * the one-open-entry rule is per row, so this is the cross-company view.
 */
export async function openShiftsForUser(userId: number): Promise<OpenShift[]> {
  const rows = await db('time_entries as te')
    .join('employees as e', 'e.id', 'te.employee_id')
    .join('companies as c', 'c.id', 'te.company_id')
    .where('e.user_id', userId)
    .whereNull('te.ended_at')
    .whereNull('te.deleted_at')
    .orderBy('te.started_at', 'asc')
    .select<
      Array<{ company_id: number; name: string; entry_type: 'work' | 'break'; started_at: Date }>
    >('te.company_id', 'c.name', 'te.entry_type', 'te.started_at');
  return rows.map((r) => ({
    companyId: r.company_id,
    companyName: r.name,
    entryType: r.entry_type,
    startedAt: r.started_at.toISOString(),
  }));
}

export async function getCurrentPunch(
  companyId: number,
  employeeId: number,
): Promise<CurrentPunchResponse> {
  const employee = await db('employees')
    .where({ id: employeeId, company_id: companyId })
    .first<{ id: number; first_name: string; last_name: string }>();
  if (!employee) throw NotFound('Employee not found');

  const [openRow, todayWorkSeconds, settings, lastClosed] = await Promise.all([
    getOpenEntry(companyId, employeeId),
    getTodayWorkSeconds(companyId, employeeId),
    db('company_settings').where({ company_id: companyId }).first<{
      punch_location_mode: CurrentPunchResponse['punchLocationMode'];
      lunch_prompt_enabled: boolean;
    }>('punch_location_mode', 'lunch_prompt_enabled'),
    db('time_entries')
      .where({ company_id: companyId, employee_id: employeeId })
      .whereNotNull('ended_at')
      .whereNull('deleted_at')
      .whereNull('superseded_by_entry_id')
      .orderBy('ended_at', 'desc')
      .first<{ ended_at: Date } | undefined>('ended_at'),
  ]);
  // The shift began with its earliest entry — a break or job switch opens
  // a new entry in the same shift, so the open row alone isn't the start.
  const shiftStart = openRow
    ? await db('time_entries')
        .where({ company_id: companyId, shift_id: openRow.shift_id })
        .whereNull('deleted_at')
        .min<{ min: Date | null }>('started_at as min')
        .first()
    : null;

  return {
    employee: {
      id: employee.id,
      firstName: employee.first_name,
      lastName: employee.last_name,
    },
    openEntry: openRow ? rowToTimeEntry(openRow) : null,
    todayWorkSeconds,
    punchLocationMode: settings?.punch_location_mode ?? 'off',
    lunchPromptEnabled: settings?.lunch_prompt_enabled ?? true,
    shiftStartedAt: shiftStart?.min ? new Date(shiftStart.min).toISOString() : null,
    lastEndedAt: lastClosed?.ended_at ? new Date(lastClosed.ended_at).toISOString() : null,
  };
}
