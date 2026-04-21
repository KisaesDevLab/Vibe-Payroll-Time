// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { CurrentPunchResponse } from '@vibept/shared';
import { db } from '../db/knex.js';
import { NotFound } from '../http/errors.js';
import { getOpenEntry, getTodayWorkSeconds, rowToTimeEntry } from './punch.js';

/**
 * Current-punch snapshot: open entry + today's running total. Used by the
 * personal-device PWA landing page. Shares the clip-to-day seconds
 * calculation with the kiosk verify response via getTodayWorkSeconds, so
 * overnight shifts attribute correctly to each day on both surfaces.
 */
export async function getCurrentPunch(
  companyId: number,
  employeeId: number,
): Promise<CurrentPunchResponse> {
  const employee = await db('employees')
    .where({ id: employeeId, company_id: companyId })
    .first<{ id: number; first_name: string; last_name: string }>();
  if (!employee) throw NotFound('Employee not found');

  const [openRow, todayWorkSeconds] = await Promise.all([
    getOpenEntry(companyId, employeeId),
    getTodayWorkSeconds(companyId, employeeId),
  ]);

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
