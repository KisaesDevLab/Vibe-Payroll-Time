// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { QueryClient } from '@tanstack/react-query';

/** Query key prefix for the employee's own correction requests. */
export const MY_CORRECTION_REQUESTS_KEY = 'my-correction-requests';

/**
 * Refetch every view of an employee's time after a change to a time
 * entry: the list timesheet, the weekly grid and the employee's
 * correction requests all read the same rows, so a change made on one
 * must show on the others.
 */
export function invalidateTimeEntryQueries(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ['my-timesheet'] });
  void qc.invalidateQueries({ queryKey: ['weekly-grid'] });
  void qc.invalidateQueries({ queryKey: [MY_CORRECTION_REQUESTS_KEY] });
  void qc.invalidateQueries({ queryKey: ['timesheet'] });
}
