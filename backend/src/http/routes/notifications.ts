// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import {
  confirmPhoneVerificationSchema,
  notificationsLogQuerySchema,
  requestPhoneVerificationSchema,
  updateEmployeePreferencesRequestSchema,
  type EmployeePreferences,
  type NotificationsLogRow,
} from '@vibept/shared';
import { Router } from 'express';
import { db } from '../../db/knex.js';
import {
  assertValidPhone,
  confirmPhoneVerification,
  startPhoneVerification,
} from '../../services/notifications/phone-verification.js';
import { Forbidden, Unauthorized } from '../errors.js';
import { requireAuth, requireCompanyRole } from '../middleware/auth.js';
import { authRateLimiter } from '../middleware/rate-limit.js';

export const notificationsRouter: Router = Router();

/**
 * Resolve the acting user's employee row for a given company. Used by
 * the self-service preferences + phone verification endpoints.
 */
async function resolveSelf(
  userId: number,
  companyId: number,
): Promise<{
  id: number;
  email: string | null;
  phone: string | null;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  phoneVerifiedAt: Date | null;
}> {
  const row = await db('employees')
    .where({ user_id: userId, company_id: companyId, status: 'active' })
    .first<{
      id: number;
      email: string | null;
      phone: string | null;
      email_notifications_enabled: boolean;
      sms_notifications_enabled: boolean;
      phone_verified_at: Date | null;
    }>();
  if (!row) throw Forbidden('You are not an active employee at this company');
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    emailNotificationsEnabled: row.email_notifications_enabled,
    smsNotificationsEnabled: row.sms_notifications_enabled,
    phoneVerifiedAt: row.phone_verified_at,
  };
}

function toPreferences(row: {
  id: number;
  email: string | null;
  phone: string | null;
  emailNotificationsEnabled: boolean;
  smsNotificationsEnabled: boolean;
  phoneVerifiedAt: Date | null;
}): EmployeePreferences {
  return {
    employeeId: row.id,
    emailNotificationsEnabled: row.emailNotificationsEnabled,
    smsNotificationsEnabled: row.smsNotificationsEnabled,
    phoneVerified: !!row.phoneVerifiedAt,
    phone: row.phone,
    email: row.email,
  };
}

// ---------------------------------------------------------------------------
// Employee self-service — /notifications/preferences?companyId=
// ---------------------------------------------------------------------------

notificationsRouter.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) return next(Forbidden('companyId required'));
    const self = await resolveSelf(req.user.id, companyId);
    res.json({ data: toPreferences(self) });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.patch('/preferences', requireAuth, async (req, res, next) => {
  try {
    if (!req.user) return next(Unauthorized());
    const companyId = Number(req.query.companyId);
    if (!Number.isFinite(companyId)) return next(Forbidden('companyId required'));
    const patch = updateEmployeePreferencesRequestSchema.parse(req.body);

    const self = await resolveSelf(req.user.id, companyId);

    // SMS opt-in requires a verified phone number. Enforce here and
    // return a clear error rather than quietly ignoring the flag.
    if (patch.smsNotificationsEnabled === true && !self.phoneVerifiedAt) {
      return next(Forbidden('Verify your phone number before enabling SMS notifications'));
    }

    const updates: Record<string, unknown> = { updated_at: db.fn.now() };
    if (patch.emailNotificationsEnabled !== undefined)
      updates.email_notifications_enabled = patch.emailNotificationsEnabled;
    if (patch.smsNotificationsEnabled !== undefined)
      updates.sms_notifications_enabled = patch.smsNotificationsEnabled;

    await db('employees').where({ id: self.id }).update(updates);
    const fresh = await resolveSelf(req.user.id, companyId);
    res.json({ data: toPreferences(fresh) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Phone verification flow
// ---------------------------------------------------------------------------

// Rate-limited so a hijacked employee token can't be used to spam SMS
// codes to the attached phone (carrier-cost attack against the
// appliance operator) or to churn the attempt counter: the per-code
// MAX_ATTEMPTS=5 gate resets on every fresh request, so without an HTTP
// gate, an attacker could request a new code between every 5 guesses.
notificationsRouter.post(
  '/phone-verification/request',
  authRateLimiter,
  requireAuth,
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const companyId = Number(req.query.companyId);
      if (!Number.isFinite(companyId)) return next(Forbidden('companyId required'));
      const body = requestPhoneVerificationSchema.parse(req.body);
      assertValidPhone(body.phone);
      const self = await resolveSelf(req.user.id, companyId);
      const result = await startPhoneVerification(companyId, self.id, body.phone);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
);

// Same rate-limiter on /confirm — without it, an attacker who knows
// the target identifier could brute the 6-digit code at wire speed.
// The per-code attempts counter caps at 5 but resets whenever a new
// code is requested.
notificationsRouter.post(
  '/phone-verification/confirm',
  authRateLimiter,
  requireAuth,
  async (req, res, next) => {
    try {
      if (!req.user) return next(Unauthorized());
      const companyId = Number(req.query.companyId);
      if (!Number.isFinite(companyId)) return next(Forbidden('companyId required'));
      const body = confirmPhoneVerificationSchema.parse(req.body);
      const self = await resolveSelf(req.user.id, companyId);
      await confirmPhoneVerification(companyId, self.id, body.code);
      const fresh = await resolveSelf(req.user.id, companyId);
      res.json({ data: toPreferences(fresh) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Admin notifications log (nested under /companies/:id)
// ---------------------------------------------------------------------------

export const notificationsAdminRouter: Router = Router({ mergeParams: true });

notificationsAdminRouter.get(
  '/:companyId/notifications-log',
  requireAuth,
  requireCompanyRole(['company_admin']),
  async (req, res, next) => {
    try {
      const companyId = Number(req.params.companyId);
      const q = notificationsLogQuerySchema.parse(req.query);

      const query = db('notifications_log')
        .where({ company_id: companyId })
        .orderBy('queued_at', 'desc')
        .limit(q.limit);
      if (q.status) query.where('status', q.status);
      if (q.channel) query.where('channel', q.channel);

      const rows = await query.select<
        Array<{
          id: number;
          company_id: number;
          recipient_type: NotificationsLogRow['recipientType'];
          recipient_id: number | null;
          recipient_address: string;
          channel: NotificationsLogRow['channel'];
          type: string;
          status: NotificationsLogRow['status'];
          provider_message_id: string | null;
          error: string | null;
          queued_at: Date;
          sent_at: Date | null;
          failed_at: Date | null;
        }>
      >(
        'id',
        'company_id',
        'recipient_type',
        'recipient_id',
        'recipient_address',
        'channel',
        'type',
        'status',
        'provider_message_id',
        'error',
        'queued_at',
        'sent_at',
        'failed_at',
      );

      res.json({
        data: rows.map(
          (r): NotificationsLogRow => ({
            id: r.id,
            companyId: r.company_id,
            recipientType: r.recipient_type,
            recipientId: r.recipient_id,
            recipientAddress: r.recipient_address,
            channel: r.channel,
            type: r.type,
            status: r.status,
            providerMessageId: r.provider_message_id,
            error: r.error,
            queuedAt: r.queued_at.toISOString(),
            sentAt: r.sent_at?.toISOString() ?? null,
            failedAt: r.failed_at?.toISOString() ?? null,
          }),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);
