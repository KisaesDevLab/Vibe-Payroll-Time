// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Router } from 'express';
import { collect, streamCsv } from '../../services/reports/csv-stream.js';
import { getReport, listReports } from '../../services/reports/index.js';
import { NotFound } from '../errors.js';
import { requireAuth, requireCompanyRole } from '../middleware/auth.js';

export const reportsRouter: Router = Router({ mergeParams: true });

/** Catalog — visible to anyone with supervisor+ on the company. */
reportsRouter.get(
  '/:companyId/reports',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor']),
  (_req, res, next) => {
    try {
      res.json({ data: listReports() });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Run a report by name.
 *   GET .../reports/:name          → JSON { columns, rows, rowCount, generatedAt }
 *   GET .../reports/:name.csv      → streaming text/csv
 *
 * Params are passed as query-string values. We accept the .csv suffix on
 * the name rather than a separate `?format=csv` because browsers get a
 * clean filename in the download dialog that way.
 */
reportsRouter.get(
  '/:companyId/reports/:name',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor']),
  async (req, res, next) => {
    try {
      const companyId = Number(req.params.companyId);
      let name = req.params.name as string;
      const asCsv = name.endsWith('.csv');
      if (asCsv) name = name.slice(0, -'.csv'.length);

      const report = getReport(name);
      if (!report) return next(NotFound(`Report "${name}" not found`));
      const params = report.paramsSchema.parse(req.query);

      if (asCsv) {
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('content-type', 'text/csv; charset=utf-8');
        res.setHeader('content-disposition', `attachment; filename="vibept-${name}-${stamp}.csv"`);
        await streamCsv(report.columns, report.rows(companyId, params), res);
        res.end();
        return;
      }

      const rows = await collect(report.rows(companyId, params));
      res.json({
        data: {
          columns: report.columns,
          rows,
          rowCount: rows.length,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);
