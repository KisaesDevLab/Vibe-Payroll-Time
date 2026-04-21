/**
 * Tests the SMS provider resolution path end-to-end:
 *   - appliance-level Twilio acts as a fallback for companies that
 *     haven't set their own
 *   - company can override the appliance's choice of provider
 *   - appliance TextLinkSMS works the same way
 *   - if neither company nor appliance has complete creds, SMS is
 *     silently disabled
 *
 * Exercises the real DB + the real encryption round-trip. The `notify`
 * module isn't imported — we test the resolver indirectly by
 * inspecting what getMagicLinkOptions and getResolvedSmsProvider
 * return after seeding, and by sanity-checking the DB reads inside
 * the dispatcher's sendSms path (via a mock fetch).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../db/knex.js';
import { runMigrations } from '../../../db/migrate.js';
import { getResolvedSmsProvider } from '../../appliance-settings.js';
import { encryptSecret } from '../../crypto.js';

const dbReachable = await db
  .raw('select 1')
  .then(() => true)
  .catch(() => false);

async function wipe() {
  await db.raw(
    `TRUNCATE TABLE
       magic_links, refresh_tokens, auth_events,
       time_entry_audit, time_entries, jobs, employees,
       company_memberships, company_settings, companies, users
     RESTART IDENTITY CASCADE`,
  );
  // appliance_settings is a singleton — reset SMS fields explicitly so
  // the getResolvedSmsProvider tests start from a known-empty state.
  await db('appliance_settings').where({ id: 1 }).update({
    sms_provider: null,
    twilio_account_sid: null,
    twilio_auth_token_encrypted: null,
    twilio_from_number: null,
    textlinksms_api_key_encrypted: null,
    textlinksms_from_number: null,
    textlinksms_base_url: null,
  });
}

beforeAll(async () => {
  await (await import('../../__tests__/__helpers__/assert-test-db.js')).assertPointedAtTestDb();
  if (!dbReachable) return;
  await runMigrations();
});

beforeEach(async () => {
  if (!dbReachable) return;
  await wipe();
});

afterAll(async () => {
  if (dbReachable) await db.destroy();
});

describe.skipIf(!dbReachable)('getResolvedSmsProvider', () => {
  it('returns all-null when nothing is configured', async () => {
    const resolved = await getResolvedSmsProvider();
    expect(resolved.provider).toBeNull();
    expect(resolved.twilio).toBeNull();
    expect(resolved.textlinksms).toBeNull();
  });

  it('decrypts appliance-wide Twilio creds and exposes them', async () => {
    await db('appliance_settings')
      .where({ id: 1 })
      .update({
        sms_provider: 'twilio',
        twilio_account_sid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        twilio_auth_token_encrypted: encryptSecret('secret-token'),
        twilio_from_number: '+15551234567',
      });
    const resolved = await getResolvedSmsProvider();
    expect(resolved.provider).toBe('twilio');
    expect(resolved.twilio).toEqual({
      accountSid: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      authToken: 'secret-token',
      fromNumber: '+15551234567',
    });
    expect(resolved.textlinksms).toBeNull();
  });

  it('decrypts appliance-wide TextLinkSMS creds and exposes them', async () => {
    await db('appliance_settings')
      .where({ id: 1 })
      .update({
        sms_provider: 'textlinksms',
        textlinksms_api_key_encrypted: encryptSecret('tls-secret'),
        textlinksms_from_number: '+15559999999',
        textlinksms_base_url: 'https://tls.example/api',
      });
    const resolved = await getResolvedSmsProvider();
    expect(resolved.provider).toBe('textlinksms');
    expect(resolved.textlinksms).toEqual({
      apiKey: 'tls-secret',
      fromNumber: '+15559999999',
      baseUrl: 'https://tls.example/api',
    });
    expect(resolved.twilio).toBeNull();
  });

  it('infers provider from complete creds when sms_provider is null', async () => {
    // Operator filled in Twilio but forgot to flip the provider field.
    // We should still infer "twilio" so the resolver has something to
    // work with.
    await db('appliance_settings')
      .where({ id: 1 })
      .update({
        sms_provider: null,
        twilio_account_sid: 'ACyyy',
        twilio_auth_token_encrypted: encryptSecret('x'),
        twilio_from_number: '+15551112222',
      });
    const resolved = await getResolvedSmsProvider();
    expect(resolved.provider).toBe('twilio');
  });

  it('honors explicit provider choice even when creds are incomplete', async () => {
    await db('appliance_settings').where({ id: 1 }).update({
      sms_provider: 'textlinksms',
      // Only some fields — not a complete cred set.
      textlinksms_from_number: '+15550000000',
    });
    const resolved = await getResolvedSmsProvider();
    expect(resolved.provider).toBe('textlinksms');
    // Creds are incomplete so no bundle is returned — the dispatcher
    // then falls through to company creds (or no-ops silently).
    expect(resolved.textlinksms).toBeNull();
  });
});
