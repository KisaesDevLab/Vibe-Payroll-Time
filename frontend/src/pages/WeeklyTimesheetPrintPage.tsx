// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Button } from '../components/Button';
import { WeeklyTimesheetPrint } from '../components/WeeklyTimesheetPrint';
import { ApiError } from '../lib/api';
import { grids } from '../lib/resources';
import type { CompanyContext } from './CompanyLayout';

/**
 * Printable weekly timesheets: `?start=YYYY-MM-DD&employees=1,2,3`.
 * One sheet per employee, each on its own page. Opens the browser's
 * print dialog once every sheet has loaded (print-based PDF, no server
 * rendering — same discipline as the report exports).
 *
 * Each sheet is the ordinary weekly-grid payload, so the server applies
 * the same access rules as the on-screen grid: an employee can print
 * only their own week.
 */
export function WeeklyTimesheetPrintPage(): JSX.Element {
  const { companyId } = useOutletContext<CompanyContext>();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const weekStart = search.get('start') ?? '';
  const employeeIds = (search.get('employees') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  const sheets = useQueries({
    queries: employeeIds.map((employeeId) => ({
      queryKey: ['weekly-grid', companyId, employeeId, weekStart],
      queryFn: () => grids.weekly(companyId, employeeId, weekStart),
      enabled: /^\d{4}-\d{2}-\d{2}$/.test(weekStart),
    })),
  });

  const loading = sheets.some((s) => s.isPending);
  const loaded = sheets.filter((s) => s.data).map((s) => s.data!);
  const failed = sheets.filter((s) => s.isError);

  // Open the print dialog once, as soon as everything is on the page.
  const printed = useRef(false);
  useEffect(() => {
    if (loading || loaded.length === 0 || printed.current) return;
    printed.current = true;
    // Let the browser lay the sheets out before the dialog snapshots them.
    const id = window.setTimeout(() => window.print(), 300);
    return () => window.clearTimeout(id);
  }, [loading, loaded.length]);

  if (employeeIds.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return <p className="text-sm text-red-700">Pick a week and at least one employee to print.</p>;
  }

  return (
    <div className="print-sheets">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {loading
            ? `Loading ${employeeIds.length} timesheet${employeeIds.length === 1 ? '' : 's'}…`
            : `${loaded.length} timesheet${loaded.length === 1 ? '' : 's'} ready to print.`}
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button disabled={loading || loaded.length === 0} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {failed.length > 0 && (
        <div className="no-print mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {failed.length} timesheet{failed.length === 1 ? '' : 's'} could not be loaded
          {failed[0]?.error instanceof ApiError ? `: ${failed[0].error.message}` : '.'}
        </div>
      )}

      {loaded.map((grid) => (
        <div
          key={grid.employee.id}
          className="mb-8 rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:mb-0 print:rounded-none print:border-0 print:p-0 print:shadow-none"
        >
          <WeeklyTimesheetPrint grid={grid} format={grid.timeFormat} />
        </div>
      ))}
    </div>
  );
}
