// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { updatePreferencesRequestSchema } from '@vibept/shared';
import { Router } from 'express';
import { getUserPreferences, updateUserPreferences } from '../../services/user-preferences.js';
import { Unauthorized } from '../errors.js';
import { requireAuth } from '../middleware/auth.js';

export const preferencesRouter: Router = Router();

preferencesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const result = await getUserPreferences(req.user.id);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

preferencesRouter.patch('/', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = updatePreferencesRequestSchema.parse(req.body);
    const result = await updateUserPreferences(req.user.id, {
      timeFormatPreference: body.timeFormatPreference,
    });
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});
