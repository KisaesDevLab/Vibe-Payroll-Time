import {
  testEmailRequestSchema,
  testSmsRequestSchema,
  updateApplianceSettingsRequestSchema,
  updateTunnelRequestSchema,
  uploadLicenseRequestSchema,
} from '@vibept/shared';
import { Router } from 'express';
import { db } from '../../db/knex.js';
import { env } from '../../config/env.js';
import {
  getApplianceSettingsForAdmin,
  updateApplianceSettings,
} from '../../services/appliance-settings.js';
import { exportCompanyAll } from '../../services/backup-export.js';
import {
  clearLicense,
  getApplianceLicenseStatus,
  uploadLicense,
} from '../../services/licensing/state.js';
import { LicenseVerifyError } from '../../services/licensing/verifier.js';
import {
  checkLatestRelease,
  getRunningVersion,
  isUpdateInProgress,
  readLastRun,
  readLogChunk,
  requestUpdate,
} from '../../services/update-manager.js';
import { VERSION, GIT_SHA, BUILD_DATE } from '../../version.js';
import { Conflict, HttpError, NotFound, Unauthorized } from '../errors.js';
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
            // Count not-terminated employees. `employees` uses status +
            // terminated_at for lifecycle — no deleted_at column.
            this.on('employees.company_id', '=', 'companies.id').andOnNull(
              'employees.terminated_at',
            );
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
          .where('queued_at', '>=', sinceIso)
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

// ---- Self-service updates (SuperAdmin only) ----
// Cheap-always-fast: running version + whether an update is mid-flight.
// Safe to poll every ~1s while an update is running.
adminRouter.get('/update/status', requireAuth, requireSuperAdmin, (_req, res, next) => {
  try {
    res.json({
      data: {
        running: getRunningVersion(),
        inProgress: isUpdateInProgress(),
        lastRun: readLastRun(),
      },
    });
  } catch (err) {
    next(err);
  }
});

// Hits GitHub's public Releases API. Returns null+reachable:false on
// network failure so the UI can say "couldn't reach GitHub" instead of
// crashing on an air-gapped appliance.
adminRouter.post('/update/check', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const result = await checkLatestRelease();
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// Writes update-control/request.json; the host-side systemd path unit
// picks it up and runs update.sh. Returns 202 — this is a queued action,
// not a synchronous one. 409 if an update is already running.
adminRouter.post('/update/run', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const result = await requestUpdate({
      userId: req.user.id,
      userEmail: req.user.email,
    });
    res.status(202).json({ data: result });
  } catch (err) {
    if (err instanceof Error && (err as { code?: string }).code === 'conflict') {
      return next(Conflict(err.message));
    }
    next(err);
  }
});

// ---- Appliance settings (SuperAdmin only) ----
// DB-backed config the operator is expected to edit at runtime. Covers
// EmailIt/AI fallbacks, retention, log level. GET never returns secret
// plaintext — instead each secret has a `*HasSecret` flag. PATCH
// accepts null to clear, a string to set, undefined to leave alone.
adminRouter.get('/settings', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const data = await getApplianceSettingsForAdmin();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/settings', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const body = updateApplianceSettingsRequestSchema.parse(req.body);
    const data = await updateApplianceSettings(body);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---- Diagnostic test sends (SuperAdmin only) ----
// Use the appliance-level fallback credentials directly so operators can
// verify their creds work before wiring them into any per-company flow.
adminRouter.post('/test-email', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const body = testEmailRequestSchema.parse(req.body);
    const { sendTestEmail } = await import('../../services/notifications/test-send.js');
    const result = await sendTestEmail(body.to);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/test-sms', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const body = testSmsRequestSchema.parse(req.body);
    const { sendTestSms } = await import('../../services/notifications/test-send.js');
    const result = await sendTestSms(body.to);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---- Cloudflare Tunnel management (SuperAdmin only) ----
// Writes a request file to the shared update-control volume; a systemd
// path unit on the host picks it up and invokes tunnel-from-request.sh,
// which edits .env and restarts the cloudflared container under the
// `cloudflare` compose profile.
adminRouter.get('/tunnel', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const { getTunnelStatus, reconcileFromStatusFile } =
      await import('../../services/tunnel-manager.js');
    // Cheap reconciliation so the DB `last_applied_at` tracks the host
    // script's most recent successful apply.
    await reconcileFromStatusFile().catch(() => undefined);
    const status = await getTunnelStatus();
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/tunnel', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = updateTunnelRequestSchema.parse(req.body);
    const { requestTunnelChange } = await import('../../services/tunnel-manager.js');
    const status = await requestTunnelChange({
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      ...(body.token !== undefined ? { token: body.token } : {}),
      actor: { userId: req.user.id, email: req.user.email },
    });
    res.status(202).json({ data: status });
  } catch (err) {
    if ((err as { code?: string }).code === 'updater_not_wired') {
      return next(new HttpError(503, 'updater_not_wired', (err as Error).message));
    }
    next(err);
  }
});

// ---- Appliance-wide license (SuperAdmin only) ----
// Licensing is per-appliance, not per-company. One JWT covers every
// non-internal company on the appliance; internal companies always
// bypass enforcement regardless.
adminRouter.get('/license', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    const data = await getApplianceLicenseStatus();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/license', requireAuth, requireSuperAdmin, async (req, res, next) => {
  try {
    const body = uploadLicenseRequestSchema.parse(req.body);
    try {
      const data = await uploadLicense(body.jwt);
      res.status(201).json({ data });
    } catch (err) {
      if (err instanceof LicenseVerifyError) {
        throw new HttpError(400, `license_${err.code}`, err.message);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

adminRouter.delete('/license', requireAuth, requireSuperAdmin, async (_req, res, next) => {
  try {
    await clearLicense();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Byte-offset log tail. Query `since=<last-offset>` to fetch the next
// chunk. `complete` flips true when no update is in progress AND the
// client has consumed the whole file.
adminRouter.get('/update/log', requireAuth, requireSuperAdmin, (req, res, next) => {
  try {
    const rawSince = req.query.since;
    const since = typeof rawSince === 'string' ? Number.parseInt(rawSince, 10) : 0;
    const chunk = readLogChunk(Number.isFinite(since) && since >= 0 ? since : 0);
    res.json({ data: chunk });
  } catch (err) {
    next(err);
  }
});
