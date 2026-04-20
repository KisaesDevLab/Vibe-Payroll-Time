import {
  chatRequestSchema,
  nlCorrectionApplyRequestSchema,
  nlCorrectionRequestSchema,
  updateAISettingsRequestSchema,
} from '@vibept/shared';
import { Router } from 'express';
import { getAISettings, updateAISettings } from '../../services/ai/config.js';
import { applyNLCorrection, previewNLCorrection } from '../../services/ai/nl-correction.js';
import { ProviderError } from '../../services/ai/provider.js';
import { supportChat } from '../../services/ai/support-chat.js';
import { HttpError, Unauthorized } from '../errors.js';
import { requireAuth, requireCompanyRole } from '../middleware/auth.js';

export const aiRouter: Router = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Settings (admin)
// ---------------------------------------------------------------------------

aiRouter.get(
  '/:companyId/ai/settings',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const result = await getAISettings(Number(req.params.companyId));
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

aiRouter.patch(
  '/:companyId/ai/settings',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const body = updateAISettingsRequestSchema.parse(req.body);
      const result = await updateAISettings(Number(req.params.companyId), body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Natural-language corrections
//   POST /companies/:id/ai/nl-correction/preview
//   POST /companies/:id/ai/nl-correction/apply
// ---------------------------------------------------------------------------

function providerErrorToHttp(err: unknown): never {
  if (err instanceof ProviderError) {
    throw new HttpError(err.status, 'provider_error', err.message);
  }
  throw err;
}

aiRouter.post('/:companyId/ai/nl-correction/preview', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = nlCorrectionRequestSchema.parse(req.body);
    try {
      const result = await previewNLCorrection(
        {
          userId: req.user.id,
          companyId: Number(req.params.companyId),
          roleGlobal: req.user.roleGlobal,
        },
        body,
      );
      res.json({ data: result });
    } catch (err) {
      providerErrorToHttp(err);
    }
  } catch (err) {
    next(err);
  }
});

aiRouter.post('/:companyId/ai/nl-correction/apply', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const body = nlCorrectionApplyRequestSchema.parse(req.body);
    const result = await applyNLCorrection(
      {
        userId: req.user.id,
        companyId: Number(req.params.companyId),
        roleGlobal: req.user.roleGlobal,
      },
      body,
    );
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Support chat (members)
// ---------------------------------------------------------------------------

aiRouter.post(
  '/:companyId/ai/chat',
  requireAuth,
  requireCompanyRole(['company_admin', 'supervisor', 'employee']),
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const body = chatRequestSchema.parse(req.body);
      try {
        const result = await supportChat(
          { userId: req.user.id, companyId: Number(req.params.companyId) },
          body,
        );
        res.json({ data: result });
      } catch (err) {
        providerErrorToHttp(err);
      }
    } catch (err) {
      next(err);
    }
  },
);
