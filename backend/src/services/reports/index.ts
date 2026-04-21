// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { ReportDefinition } from '@vibept/shared';
import { auditTrailReport } from './audit-trail.js';
import { hoursByJobReport } from './hours-by-job.js';
import { hoursByPeriodReport } from './hours-by-period.js';
import { overtimeReport } from './overtime.js';
import { punchActivityReport } from './punch-activity.js';
import { timeCardReport } from './time-card.js';
import type { ReportHandler } from './types.js';

// Type-erased registry so the HTTP layer can dispatch by name without
// carrying each handler's param generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers: Record<string, ReportHandler<any>> = {
  [timeCardReport.name]: timeCardReport,
  [punchActivityReport.name]: punchActivityReport,
  [hoursByPeriodReport.name]: hoursByPeriodReport,
  [hoursByJobReport.name]: hoursByJobReport,
  [overtimeReport.name]: overtimeReport,
  [auditTrailReport.name]: auditTrailReport,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getReport(name: string): ReportHandler<any> | undefined {
  return handlers[name];
}

export function listReports(): ReportDefinition[] {
  return Object.values(handlers).map((h) => ({
    name: h.name,
    label: h.label,
    description: h.description,
    columns: h.columns,
    params: h.paramFields,
  }));
}
