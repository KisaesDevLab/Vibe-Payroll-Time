import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX } from '@vibept/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { companiesRouter } from './routes/companies.js';
import { healthRouter, versionRouter } from './routes/health.js';
import { kioskRouter } from './routes/kiosk.js';
import { payrollExportsRouter } from './routes/payroll-exports.js';
import { punchRouter } from './routes/punch.js';
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
      origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
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

  app.use(`${API_PREFIX}/health`, healthRouter);
  app.use(`${API_PREFIX}/version`, versionRouter);
  app.use(`${API_PREFIX}/setup`, setupRouter);
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/companies`, companiesRouter);
  app.use(`${API_PREFIX}/companies`, correctionsRouter);
  app.use(`${API_PREFIX}/companies`, reportsRouter);
  app.use(`${API_PREFIX}/companies`, payrollExportsRouter);
  app.use(`${API_PREFIX}/punch`, punchRouter);
  app.use(`${API_PREFIX}/kiosk`, kioskRouter);
  app.use(`${API_PREFIX}/timesheets`, timesheetsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
