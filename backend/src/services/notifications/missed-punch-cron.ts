// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import cron from 'node-cron';
import { logger } from '../../config/logger.js';
import { db } from '../../db/knex.js';
import { notify } from './service.js';

/**
 * Sweep every 5 minutes. For each open entry older than the company's
 * missed_punch_reminder_hours, fire a single notification to the
 * employee. We rate-limit to one reminder per open entry per 2 hours
 * so a forgetful employee doesn't receive 24 reminders overnight — the
 * auto-clockout cron (Phase 5) eventually closes the entry anyway.
 */
const REMINDER_COOLDOWN_HOURS = 2;

export async function runMissedPunchSweep(): Promise<number> {
  const start = Date.now();

  // Pull candidate entries and the employee/company context in one
  // join. We check prior notification by looking at the log.
  const rows = await db('time_entries as t')
    .join('employees as e', 'e.id', 't.employee_id')
    .join('company_settings as s', 's.company_id', 't.company_id')
    .join('companies as c', 'c.id', 't.company_id')
    .whereNull('t.ended_at')
    .whereNull('t.deleted_at')
    .where('e.status', 'active')
    .whereRaw(`t.started_at < now() - (s.missed_punch_reminder_hours || ' hours')::interval`)
    .select<
      Array<{
        entry_id: number;
        employee_id: number;
        company_id: number;
        first_name: string;
        last_name: string;
        email: string | null;
        phone: string | null;
        email_opt: boolean;
        sms_opt: boolean;
        phone_verified: Date | null;
        started_at: Date;
        company_name: string;
      }>
    >('t.id as entry_id', 't.employee_id', 't.company_id', 'e.first_name', 'e.last_name', 'e.email', 'e.phone', 'e.email_notifications_enabled as email_opt', 'e.sms_notifications_enabled as sms_opt', 'e.phone_verified_at as phone_verified', 't.started_at', 'c.name as company_name');

  if (rows.length === 0) return 0;

  let sent = 0;
  for (const r of rows) {
    const recent = await db('notifications_log')
      .where({
        company_id: r.company_id,
        recipient_id: r.employee_id,
        type: 'missed_punch_reminder',
      })
      .whereRaw(`queued_at > now() - (?::integer || ' hours')::interval`, [REMINDER_COOLDOWN_HOURS])
      .first<{ id: number }>();
    if (recent) continue;

    const elapsedHours = ((Date.now() - r.started_at.getTime()) / 3_600_000).toFixed(1);

    try {
      await notify({
        companyId: r.company_id,
        type: 'missed_punch_reminder',
        recipient: {
          kind: 'employee',
          id: r.employee_id,
          email: r.email,
          phone: r.phone,
          emailOptIn: r.email_opt,
          smsOptIn: r.sms_opt,
          phoneVerified: !!r.phone_verified,
        },
        vars: {
          firstName: r.first_name,
          companyName: r.company_name,
          startedAt: r.started_at.toISOString(),
          elapsedHours,
          myPunchUrl: '/my-punch',
        },
      });
      sent += 1;
    } catch (err) {
      logger.error({ err, entry_id: r.entry_id }, 'missed-punch notify threw');
    }
  }

  logger.info(
    { scanned: rows.length, sent, elapsed: Date.now() - start },
    'missed-punch sweep complete',
  );
  return sent;
}

export function scheduleMissedPunchReminder(): () => void {
  const task = cron.schedule('*/5 * * * *', () => {
    runMissedPunchSweep().catch((err) => logger.error({ err }, 'missed-punch sweep threw'));
  });
  logger.info('missed-punch reminder sweep scheduled (every 5 minutes)');
  return () => task.stop();
}
