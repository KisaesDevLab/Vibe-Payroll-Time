// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
/**
 * Kiosk route responses the tablet renders directly:
 *   - clock-out carries `todayWorkSeconds`, computed after the close;
 *   - /kiosk/me carries the company's default hours format;
 *   - /kiosk/unpair revokes the device's own token.
 *
 * Skipped when Postgres isn't reachable.
 */
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { createApp } from '../../http/app.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let baseUrl = '';
let server: { close: (cb?: () => void) => void };

let companyId = 0;
let employeeId = 0;
let deviceId = 0;
let deviceToken = '';

const sha256Hex = (v: string) => crypto.createHash('sha256').update(v, 'utf8').digest('hex');

function employeeSession(): string {
  return jwt.sign(
    { sub: String(employeeId), typ: 'kiosk_employee', kioskDeviceId: deviceId, companyId },
    env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: 300 },
  );
}

async function api(
  path: string,
  opts: { method?: string; body?: unknown; session?: boolean } = {},
): Promise<{ status: number; body: { data?: Record<string, unknown> } | null }> {
  const headers: Record<string, string> = { 'x-kiosk-device-token': deviceToken };
  if (opts.session) headers['x-kiosk-employee-session'] = employeeSession();
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function seed(): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE time_entry_audit, time_entries, jobs, employees, company_memberships,
       company_settings, companies, users, auth_events, refresh_tokens, kiosk_devices,
       kiosk_pairing_codes
     RESTART IDENTITY CASCADE`,
  );
  const [c] = await db('companies')
    .insert({
      name: 'Kiosk Co',
      slug: 'kiosk-co',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: false,
    })
    .returning<Array<{ id: number }>>('id');
  companyId = Number(c!.id);
  await db('company_settings').insert({
    company_id: companyId,
    kiosk_auth_mode: 'pin',
    time_format_default: 'hhmm',
  });
  const [e] = await db('employees')
    .insert({ company_id: companyId, first_name: 'Kim', last_name: 'K', status: 'active' })
    .returning<Array<{ id: number }>>('id');
  employeeId = Number(e!.id);
  deviceToken = crypto.randomBytes(48).toString('base64url');
  const [d] = await db('kiosk_devices')
    .insert({ company_id: companyId, name: 'Front', token_hash: sha256Hex(deviceToken) })
    .returning<Array<{ id: number }>>('id');
  deviceId = Number(d!.id);
}

describe.skipIf(!dbReachable)('kiosk routes (tablet-facing responses)', () => {
  beforeAll(async () => {
    await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
    await runMigrations();
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = (server as unknown as { address: () => AddressInfo }).address();
    baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.destroy().catch(() => undefined);
  });

  beforeEach(async () => {
    await seed();
  });

  it('clock-out returns the day’s worked seconds, including the shift just closed', async () => {
    // An earlier closed 2h shift today plus the open one (started 1h ago).
    const now = Date.now();
    const shiftA = crypto.randomUUID();
    const shiftB = crypto.randomUUID();
    // Keep both inside the current UTC day even right after midnight.
    const dayStart = new Date(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
    const sinceMidnight = now - dayStart;
    const openFor = Math.min(3600_000, Math.floor(sinceMidnight / 3));
    const earlier = Math.min(7200_000, Math.floor(sinceMidnight / 3));
    await db('time_entries').insert([
      {
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftA,
        entry_type: 'work',
        started_at: new Date(dayStart + 1000),
        ended_at: new Date(dayStart + 1000 + earlier),
        duration_seconds: Math.floor(earlier / 1000),
        source: 'kiosk',
      },
      {
        company_id: companyId,
        employee_id: employeeId,
        shift_id: shiftB,
        entry_type: 'work',
        started_at: new Date(now - openFor),
        source: 'kiosk',
      },
    ]);

    const res = await api('/kiosk/punch/clock-out', { method: 'POST', body: {}, session: true });
    expect(res.status).toBe(200);
    const data = res.body!.data!;
    expect(data.endedAt).toBeTruthy();
    const expected = Math.floor(earlier / 1000) + Math.floor(openFor / 1000);
    expect(typeof data.todayWorkSeconds).toBe('number');
    // Allow a few seconds for request latency between the insert and the close.
    expect(Math.abs((data.todayWorkSeconds as number) - expected)).toBeLessThanOrEqual(5);
  });

  it('/kiosk/me carries the company default time format', async () => {
    const res = await api('/kiosk/me');
    expect(res.status).toBe(200);
    expect(res.body!.data!.timeFormat).toBe('hhmm');
  });

  it('/kiosk/unpair revokes the device token', async () => {
    const res = await api('/kiosk/unpair', { method: 'POST' });
    expect(res.status).toBe(204);
    const row = await db('kiosk_devices').where({ id: deviceId }).first<{ revoked_at: Date }>();
    expect(row.revoked_at).not.toBeNull();
    const after = await api('/kiosk/me');
    expect(after.status).toBe(401);
  });
});
