// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Route-level tests for the SuperAdmin appliance health snapshot, focused on
 * the aiRouter registration field: direct mode reports 'disabled', and a
 * failing registration (wrong token identity → 403) is visible in the
 * response instead of only in the logs.
 *
 * Skipped when Postgres isn't reachable.
 */
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import { createApp } from '../../http/app.js';
import {
  _resetRouterRegistrationForTests,
  _setAiModeForTests,
  _setRouterClientForTests,
  registerRouterTaskClasses,
} from '../ai/router-mode.js';
import { VibeAiClient } from '../ai/vibe-ai-client.js';
import { hashPassword } from '../passwords.js';
import { issueAccessToken } from '../tokens.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

let baseUrl = '';
let server: { close: (cb?: () => void) => void };
let superAdminToken = '';
let plainUserToken = '';

async function seed(): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE
       time_entry_audit,
       time_entries,
       employees,
       company_memberships,
       company_settings,
       companies,
       users,
       auth_events,
       refresh_tokens,
       notifications_log
     RESTART IDENTITY CASCADE`,
  );

  const pw = await hashPassword('aggressive-test-pw-12345');
  const [superAdmin] = await db('users')
    .insert({ email: 'super@vibept.local', password_hash: pw, role_global: 'super_admin' })
    .returning<Array<{ id: number }>>('id');
  const [plain] = await db('users')
    .insert({ email: 'plain@vibept.local', password_hash: pw, role_global: 'none' })
    .returning<Array<{ id: number }>>('id');

  superAdminToken = issueAccessToken({
    id: superAdmin!.id,
    email: 'super@vibept.local',
    roleGlobal: 'super_admin',
  }).token;
  plainUserToken = issueAccessToken({
    id: plain!.id,
    email: 'plain@vibept.local',
    roleGlobal: 'none',
  }).token;
}

async function getHealth(bearer?: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${baseUrl}/admin/health`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Drain chained promise jobs so the fire-and-forget registration attempt settles. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe.skipIf(!dbReachable)('GET /admin/health (aiRouter field)', () => {
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

  afterEach(() => {
    _setRouterClientForTests(undefined);
    _setAiModeForTests(undefined);
    _resetRouterRegistrationForTests();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await getHealth();
    expect(res.status).toBe(401);
  });

  it('rejects non-super-admin users', async () => {
    const res = await getHealth(plainUserToken);
    expect(res.status).toBe(403);
  });

  it('reports direct mode with a disabled registration by default', async () => {
    const res = await getHealth(superAdminToken);
    expect(res.status).toBe(200);
    const data = (res.body as { data: { aiRouter: unknown } }).data;
    expect(data.aiRouter).toMatchObject({
      mode: 'direct',
      registration: { status: 'disabled', attempts: 0, lastError: null },
    });
  });

  it('surfaces a failing registration (403 wrong token identity) in the response', async () => {
    _setAiModeForTests('router');
    _setRouterClientForTests(
      new VibeAiClient({
        baseUrl: 'http://router.test:8220',
        token: 'minted-for-the-wrong-identity',
        fetch: (async () =>
          new Response(
            JSON.stringify({ error: { code: 'auth_error', message: 'token identity mismatch' } }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          )) as typeof fetch,
      }),
    );
    registerRouterTaskClasses();
    await flushMicrotasks();

    const res = await getHealth(superAdminToken);
    expect(res.status).toBe(200);
    const data = (res.body as { data: { aiRouter: unknown } }).data;
    expect(data.aiRouter).toMatchObject({
      mode: 'router',
      registration: {
        status: 'failing',
        attempts: 1,
        lastError: { status: 403, code: 'auth_error', message: 'token identity mismatch' },
        nextRetryInMs: 300_000,
      },
    });
  });
});
