import { preflightRequestSchema, runExportRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import fs from 'node:fs';
import { db } from '../../db/knex.js';
import { listExports, openExportFile, runExport } from '../../services/payroll-exports/engine.js';
import { runPreflight } from '../../services/payroll-exports/preflight.js';
import { NotFound, Unauthorized } from '../errors.js';
import { requireAuth, requireCompanyRole } from '../middleware/auth.js';

export const payrollExportsRouter: Router = Router({ mergeParams: true });

payrollExportsRouter.post(
  '/:companyId/payroll-exports/preflight',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const companyId = Number(req.params.companyId);
      const body = preflightRequestSchema.parse(req.body);
      const result = await runPreflight(
        companyId,
        new Date(body.periodStart),
        new Date(body.periodEnd),
      );
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

payrollExportsRouter.post(
  '/:companyId/payroll-exports',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const companyId = Number(req.params.companyId);
      const body = runExportRequestSchema.parse(req.body);

      const company = await db('companies').where({ id: companyId }).first<{ name: string }>();
      if (!company) return next(NotFound('Company not found'));

      const result = await runExport({
        companyId,
        companyName: company.name,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        format: body.format,
        actorUserId: req.user.id,
        acknowledgeReExport: body.acknowledgeReExport,
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.genericColumns ? { genericColumns: body.genericColumns } : {}),
        ...(body.genericTimeFormat ? { genericTimeFormat: body.genericTimeFormat } : {}),
      });
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

payrollExportsRouter.get(
  '/:companyId/payroll-exports',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const rows = await listExports(Number(req.params.companyId));
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  },
);

payrollExportsRouter.get(
  '/:companyId/payroll-exports/:id/download',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const resolved = await openExportFile(Number(req.params.companyId), Number(req.params.id));
      if (!resolved) {
        res.status(410).json({
          error: {
            code: 'gone',
            message: 'Export file no longer available on disk.',
          },
        });
        return;
      }

      const filename = `vibept-${resolved.row.format}-${resolved.row.periodStart.slice(0, 10)}.csv`;
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="${filename}"`);
      fs.createReadStream(resolved.absolutePath).pipe(res);
    } catch (err) {
      next(err);
    }
  },
);
