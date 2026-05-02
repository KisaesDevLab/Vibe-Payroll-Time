// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { db } from '../db/knex.js';

// Phase 14.2 — three timezone layers, in precedence order:
//   1. Per-employee `employees.timezone` (override; nullable)
//   2. Per-firm    `companies.timezone` (required)
//   3. Host        `TZ` env var (Docker-propagated; baseline default)
//
// The host TZ is rarely consulted for timesheet math — the firm TZ is
// always set during setup — but it serves as the last-resort default
// for any code path that runs before company context is loaded.
//
// IMPORTANT — this resolver is for DISPLAY formatting only ("the
// employee sees punch times in their own watch's TZ"). It must NOT
// be passed into the timesheet summary builder: pay-period
// boundaries, day grouping, and FLSA workweek boundaries are legally
// per-EMPLOYER, not per-employee, and shifting them by viewer would
// be wage-and-hour-claim surface and desync admin/employee views.
// See `backend/src/services/timesheets.ts` getTimesheet for the
// firm-TZ-only summary path and where the per-employee TZ is
// preserved in the response for the future row-formatter.

export async function resolveEmployeeTimezone(
  companyId: number,
  employeeId: number,
): Promise<string> {
  const row = await db('employees as e')
    .join('companies as c', 'c.id', 'e.company_id')
    .where('e.id', employeeId)
    .where('e.company_id', companyId)
    .select<{
      employee_tz: string | null;
      company_tz: string;
    }>('e.timezone as employee_tz', 'c.timezone as company_tz')
    .first();
  if (!row) throw new Error(`employee ${employeeId} not found in company ${companyId}`);
  return row.employee_tz ?? row.company_tz;
}
