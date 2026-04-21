/**
 * appliance-settings service — DB-backed config + env fallback.
 * Integration test: uses the real DB so encryption / ?? / etc. all
 * exercise production code paths.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import {
  getApplianceSettingsForAdmin,
  getResolvedAI,
  getResolvedEmailit,
  getResolvedLogLevel,
  getResolvedRetentionDays,
  updateApplianceSettings,
} from '../appliance-settings.js';
import { decryptSecret } from '../crypto.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

async function wipeSettingsColumns() {
  await db('appliance_settings').where({ id: 1 }).update({
    emailit_api_key_encrypted: null,
    emailit_from_email: null,
    emailit_from_name: null,
    emailit_api_base_url: null,
    ai_provider: null,
    ai_api_key_encrypted: null,
    ai_model: null,
    ai_base_url: null,
    retention_days: null,
    log_level: null,
  });
}

beforeAll(async () => {
  if (!dbReachable) return;
  await runMigrations();
});

beforeEach(async () => {
  if (!dbReachable) return;
  await wipeSettingsColumns();
});

afterAll(async () => {
  if (dbReachable) await db.destroy();
});

describe.skipIf(!dbReachable)('appliance-settings service', () => {
  it('getResolvedEmailit falls through to env when DB is empty', async () => {
    const resolved = await getResolvedEmailit();
    // Env vars are set by vitest.config.ts at 'test' mode — the
    // integration harness doesn't set EMAILIT_API_KEY, so apiKey is null.
    expect(resolved.apiKey).toBeNull();
    // EMAILIT_FROM_NAME has a default in env.ts.
    expect(resolved.fromName).toBe('Vibe Payroll Time');
    expect(resolved.apiBaseUrl).toBe('https://api.emailit.com/v2');
  });

  it('getResolvedEmailit prefers DB values over env', async () => {
    await updateApplianceSettings({
      emailit: {
        apiKey: 'db-stored-key',
        fromEmail: 'db@firm.com',
        fromName: 'Stored Firm',
        apiBaseUrl: 'https://mailer.example.com/v1',
      },
    });
    const resolved = await getResolvedEmailit();
    expect(resolved.apiKey).toBe('db-stored-key');
    expect(resolved.fromEmail).toBe('db@firm.com');
    expect(resolved.fromName).toBe('Stored Firm');
    expect(resolved.apiBaseUrl).toBe('https://mailer.example.com/v1');
  });

  it('encrypts the emailit api key at rest (never stores plaintext)', async () => {
    await updateApplianceSettings({ emailit: { apiKey: 'plaintext-secret' } });
    const row = await db('appliance_settings').where({ id: 1 }).first();
    expect(row.emailit_api_key_encrypted).toBeTruthy();
    expect(row.emailit_api_key_encrypted).not.toBe('plaintext-secret');
    expect(decryptSecret(row.emailit_api_key_encrypted)).toBe('plaintext-secret');
  });

  it('clearing with null removes the stored secret', async () => {
    await updateApplianceSettings({ emailit: { apiKey: 'will-be-cleared' } });
    await updateApplianceSettings({ emailit: { apiKey: null } });
    const row = await db('appliance_settings').where({ id: 1 }).first();
    expect(row.emailit_api_key_encrypted).toBeNull();
  });

  it('undefined field means "no change"', async () => {
    await updateApplianceSettings({ emailit: { apiKey: 'first' } });
    await updateApplianceSettings({ emailit: { fromEmail: 'first@x.com' } });
    const row = await db('appliance_settings').where({ id: 1 }).first();
    // apiKey must NOT have been cleared by the second call.
    expect(decryptSecret(row.emailit_api_key_encrypted)).toBe('first');
    expect(row.emailit_from_email).toBe('first@x.com');
  });

  it('getResolvedAI falls through to env for provider/apiKey/model/baseUrl', async () => {
    const ai = await getResolvedAI();
    expect(ai.provider).toBe('anthropic'); // env default
    expect(ai.apiKey).toBeNull();
    expect(ai.model).toBeNull();
    expect(ai.baseUrl).toBeNull();
  });

  it('getResolvedAI reflects DB overrides', async () => {
    await updateApplianceSettings({
      ai: {
        provider: 'openai_compatible',
        apiKey: 'sk-stored',
        model: 'gpt-custom',
        baseUrl: 'https://proxy.example.com',
      },
    });
    const ai = await getResolvedAI();
    expect(ai.provider).toBe('openai_compatible');
    expect(ai.apiKey).toBe('sk-stored');
    expect(ai.model).toBe('gpt-custom');
    expect(ai.baseUrl).toBe('https://proxy.example.com');
  });

  it('getResolvedRetentionDays defaults to 14 when nothing set', async () => {
    const prev = process.env.RETENTION_DAYS;
    delete process.env.RETENTION_DAYS;
    try {
      expect(await getResolvedRetentionDays()).toBe(14);
    } finally {
      if (prev !== undefined) process.env.RETENTION_DAYS = prev;
    }
  });

  it('getResolvedRetentionDays uses env when DB is null', async () => {
    const prev = process.env.RETENTION_DAYS;
    process.env.RETENTION_DAYS = '45';
    try {
      expect(await getResolvedRetentionDays()).toBe(45);
    } finally {
      if (prev === undefined) delete process.env.RETENTION_DAYS;
      else process.env.RETENTION_DAYS = prev;
    }
  });

  it('getResolvedRetentionDays prefers DB value over env', async () => {
    const prev = process.env.RETENTION_DAYS;
    process.env.RETENTION_DAYS = '45';
    try {
      await updateApplianceSettings({ retentionDays: 7 });
      expect(await getResolvedRetentionDays()).toBe(7);
    } finally {
      if (prev === undefined) delete process.env.RETENTION_DAYS;
      else process.env.RETENTION_DAYS = prev;
    }
  });

  it('getResolvedLogLevel prefers DB, falls through to env', async () => {
    expect(await getResolvedLogLevel()).toBe('silent'); // vitest env sets silent
    await updateApplianceSettings({ logLevel: 'debug' });
    expect(await getResolvedLogLevel()).toBe('debug');
    await updateApplianceSettings({ logLevel: null });
    expect(await getResolvedLogLevel()).toBe('silent');
  });

  it('getApplianceSettingsForAdmin never returns plaintext secrets', async () => {
    await updateApplianceSettings({
      emailit: { apiKey: 'should-not-leak' },
      ai: { apiKey: 'also-should-not-leak' },
    });
    const view = await getApplianceSettingsForAdmin();
    expect(view.emailit.apiKeyHasSecret).toBe(true);
    expect(view.emailit.apiKeySource).toBe('db');
    expect(view.ai.apiKeyHasSecret).toBe(true);
    expect(view.ai.apiKeySource).toBe('db');
    // Defensive: serialize and look for the plaintext.
    const json = JSON.stringify(view);
    expect(json).not.toContain('should-not-leak');
    expect(json).not.toContain('also-should-not-leak');
  });

  it('getApplianceSettingsForAdmin reports source=env when only env is set', async () => {
    const view = await getApplianceSettingsForAdmin();
    // EMAILIT_FROM_NAME has an env default of "Vibe Payroll Time".
    expect(view.emailit.fromNameSource).toBe('env');
    expect(view.emailit.fromName).toBe('Vibe Payroll Time');
  });

  it('source flips db→env when a DB value is cleared', async () => {
    await updateApplianceSettings({ emailit: { fromName: 'Stored Name' } });
    let view = await getApplianceSettingsForAdmin();
    expect(view.emailit.fromNameSource).toBe('db');
    expect(view.emailit.fromName).toBe('Stored Name');

    await updateApplianceSettings({ emailit: { fromName: null } });
    view = await getApplianceSettingsForAdmin();
    expect(view.emailit.fromNameSource).toBe('env');
    expect(view.emailit.fromName).toBe('Vibe Payroll Time');
  });
});
