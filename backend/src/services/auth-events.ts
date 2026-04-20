import type { Knex } from 'knex';
import { db } from '../db/knex.js';

export type AuthEventType =
  | 'login_success'
  | 'login_failure'
  | 'refresh'
  | 'logout'
  | 'setup_initial'
  | 'password_change'
  | 'password_reset_requested'
  | 'password_reset_completed';

export interface RecordAuthEventInput {
  eventType: AuthEventType;
  userId?: number | null;
  companyId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only. Never edit or delete — this log is part of the audit trail
 * CPA firms rely on. Accepts a Knex transaction so callers can commit
 * event + state in one atomic unit.
 */
export async function recordAuthEvent(
  input: RecordAuthEventInput,
  trx?: Knex.Transaction,
): Promise<void> {
  const q = trx ?? db;
  await q('auth_events').insert({
    user_id: input.userId ?? null,
    company_id: input.companyId ?? null,
    event_type: input.eventType,
    ip: input.ip ?? null,
    user_agent: input.userAgent?.slice(0, 512) ?? null,
    metadata: JSON.stringify(input.metadata ?? {}),
  });
}
