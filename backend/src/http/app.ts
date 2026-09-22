// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@vibept/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { parseAllowedOrigins } from '../config/public-url.js';
import {
  getVibeAuth,
  isRateLimitedAuthPath,
  vibeAuthMiddleware,
} from '../services/vibe-auth/engine.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { setRevocationCheck } from './middleware/auth.js';
import { authRateLimiter } from './middleware/rate-limit.js';
import { adminRouter } from './routes/admin.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { companiesRouter } from './routes/companies.js';
import { applianceInfoRouter, healthRouter, pingRouter, versionRouter } from './routes/health.js';
import { kioskRouter } from './routes/kiosk.js';
import { licensingRouter } from './routes/licensing.js';
import { manualEntriesRouter } from './routes/manual-entries.js';
import { notificationsAdminRouter, notificationsRouter } from './routes/notifications.js';
import { payrollExportsRouter } from './routes/payroll-exports.js';
import { preferencesRouter } from './routes/preferences.js';
import { punchRouter } from './routes/punch.js';
import { userPhoneRouter } from './routes/user-phone.js';
import { reportsRouter } from './routes/reports.js';
import { setupRouter } from './routes/setup.js';
import { correctionsRouter, timesheetsRouter } from './routes/timesheets.js';

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin: parseAllowedOrigins(env.ALLOWED_ORIGIN),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  // Single sign-on (Vibe Auth). The engine claims only /auth/* — never
  // anything under /api — so the kiosk realm (/api/v1/kiosk/*, device
  // token + PIN/badge) cannot pass through it in any mode. Mounted after
  // the body parsers because the IdP's back-channel logout posts a form.
  // The browser-driven OIDC steps share the auth limiter's budget.
  app.use((req, res, next) =>
    isRateLimitedAuthPath(req.path) ? authRateLimiter(req, res, next) : next(),
  );
  app.use(vibeAuthMiddleware());
  // requireAuth honours IdP back-channel logouts through this check.
  setRevocationCheck((key, issuedAtMs) => getVibeAuth().isRevoked(key, issuedAtMs));

  app.use(`${API_PREFIX}/ping`, pingRouter);
  app.use(`${API_PREFIX}/health`, healthRouter);
  app.use(`${API_PREFIX}/version`, versionRouter);
  app.use(`${API_PREFIX}/appliance/info`, applianceInfoRouter);
  app.use(`${API_PREFIX}/setup`, setupRouter);
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/companies`, companiesRouter);
  app.use(`${API_PREFIX}/companies`, correctionsRouter);
  app.use(`${API_PREFIX}/companies`, reportsRouter);
  app.use(`${API_PREFIX}/companies`, payrollExportsRouter);
  app.use(`${API_PREFIX}/companies`, notificationsAdminRouter);
  app.use(`${API_PREFIX}/companies`, aiRouter);
  app.use(`${API_PREFIX}/companies`, licensingRouter);
  app.use(`${API_PREFIX}/punch`, punchRouter);
  app.use(`${API_PREFIX}/kiosk`, kioskRouter);
  app.use(`${API_PREFIX}/timesheets`, timesheetsRouter);
  app.use(`${API_PREFIX}/manual-entries`, manualEntriesRouter);
  app.use(`${API_PREFIX}/me/preferences`, preferencesRouter);
  app.use(`${API_PREFIX}/me/phone`, userPhoneRouter);
  app.use(`${API_PREFIX}/notifications`, notificationsRouter);
  app.use(`${API_PREFIX}/admin`, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
