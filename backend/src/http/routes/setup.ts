import { setupInitialRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import { getSetupStatus, runInitialSetup } from '../../services/setup.js';
import { authRateLimiter } from '../middleware/rate-limit.js';

export const setupRouter: Router = Router();

setupRouter.get('/status', async (_req, res, next) => {
  try {
    const status = await getSetupStatus();
    res.json({ data: status });
  } catch (err) {
    next(err);
  }
});

setupRouter.post('/initial', authRateLimiter, async (req, res, next) => {
  try {
    const body = setupInitialRequestSchema.parse(req.body);
    const ctx = { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
    const session = await runInitialSetup(body, ctx);
    res.status(201).json({ data: session });
  } catch (err) {
    next(err);
  }
});
