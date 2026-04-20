import { Router } from 'express';
import { db } from '../../db/knex.js';
import { env } from '../../config/env.js';
import { exportCompanyAll } from '../../services/backup-export.js';
import { VERSION, GIT_SHA, BUILD_DATE } from '../../version.js';
import { NotFound, Unauthorized } from '../errors.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export const adminRouter: Router = Router();

/**
 * SuperAdmin appliance health snapshot. Surfaces everything the ops UI
 * needs to show a green/yellow/red dot without pulling from 10 places:
 *   - DB connectivity + row counts per tenant
 *   - License enforcement flag + per-company license state
 *   - Background cron wiring (indirectly, via last-run timestamps)
 *   - Notification log tail counts (last 24h success/failure)
 */
adminRouter.get('/health', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    let dbOk = false;
    try {
      await db.raw('select 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }

    const companies = dbOk
      ? await db('companies')
          .leftJoin('employees', function () {
            this.on('employees.company_id', '=', 'companies.id').andOnNull('employees.deleted_at');
          })
          .groupBy('companies.id')
          .select<
            Array<{
              id: number;
              name: string;
              slug: string;
              is_internal: boolean;
              license_state: string;
              employee_count: string;
            }>
          >(
            'companies.id',
            'companies.name',
            'companies.slug',
            'companies.is_internal',
            'companies.license_state',
            db.raw('count(employees.id)::text as employee_count'),
          )
          .orderBy('companies.name')
      : [];

    const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const notif24h = dbOk
      ? await db('notifications_log')
          .where('created_at', '>=', sinceIso)
          .select('status')
          .count<{ status: string; count: string }[]>('* as count')
          .groupBy('status')
      : [];

    const openEntries = dbOk
      ? await db('time_entries')
          .whereNull('ended_at')
          .whereNull('deleted_at')
          .count<{ count: string }[]>('* as count')
          .first()
      : null;

    res.json({
      data: {
        appliance: {
          id: env.APPLIANCE_ID,
          version: VERSION,
          gitSha: GIT_SHA,
          buildDate: BUILD_DATE,
          nodeEnv: env.NODE_ENV,
        },
        checks: {
          db: dbOk ? 'ok' : 'fail',
          licensingEnforced: env.LICENSING_ENFORCED,
          notificationsDisabled: env.NOTIFICATIONS_DISABLED,
          aiProviderDefault: env.AI_PROVIDER_DEFAULT,
        },
        companies: companies.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          isInternal: c.is_internal,
          licenseState: c.license_state,
          employeeCount: Number(c.employee_count),
        })),
        runtime: {
          openTimeEntries: openEntries ? Number(openEntries.count) : 0,
          notifications24h: Object.fromEntries(notif24h.map((n) => [n.status, Number(n.count)])),
        },
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Level-4 on-demand export. SuperAdmin only: produces a ZIP containing
 * JSONL per table for the requested company, plus a manifest. Streams
 * so we can export multi-year tenants without buffering to disk.
 */
adminRouter.get(
  '/companies/:companyId/export-all',
  requireAuth,
  requireSuperAdmin,
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const companyId = Number(req.params.companyId);
      if (!Number.isFinite(companyId) || companyId <= 0) {
        return next(NotFound('Company not found'));
      }
      const company = await db('companies').where({ id: companyId }).first<{ slug: string }>();
      if (!company) return next(NotFound('Company not found'));

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `vibept-${company.slug}-${stamp}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      await exportCompanyAll(res, {
        companyId,
        requestedBy: { id: req.user.id, email: req.user.email },
      });
    } catch (err) {
      next(err);
    }
  },
);
