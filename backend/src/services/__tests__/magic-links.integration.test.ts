// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Magic-link login integration tests. Exercise the full token lifecycle
 * against the real DB so the unique constraint, expiry clipping, and
 * single-use flip are validated.
 *
 * The `notify()` side effect is a no-op in this environment because
 * NOTIFICATIONS_DISABLED=true at test setup — we only care about the
 * DB state here, not whether an email actually sent.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../db/knex.js';
import { runMigrations } from '../../db/migrate.js';
import {
  consumeMagicLink,
  getMagicLinkOptions,
  requestMagicLink,
  requestPasswordReset,
  sendAccountLink,
} from '../magic-links.js';
import { hashPassword } from '../passwords.js';

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
  // appliance_settings is a singleton so TRUNCATE isn't safe — null
  // out any fields prior tests might have set so the options check
  // starts from a known-empty state.
  await db('appliance_settings').where({ id: 1 }).update({
    emailit_api_key_encrypted: null,
    emailit_from_email: null,
  });
}

let userId: number;
let companyId: number;

async function seed() {
  await wipe();
  const [u] = await db('users')
    .insert({
      email: 'admin@test.local',
      password_hash: await hashPassword('test-passphrase-12345'),
      role_global: 'super_admin',
    })
    .returning<Array<{ id: number }>>('id');
  userId = u!.id;

  const [co] = await db('companies')
    .insert({
      name: 'Test Co',
      slug: 'test-magic',
      timezone: 'UTC',
      pay_period_type: 'bi_weekly',
      is_internal: true,
      license_state: 'internal_free',
    })
    .returning<Array<{ id: number }>>('id');
  companyId = co!.id;
  await db('company_settings').insert({ company_id: companyId, allow_self_approve: true });
  await db('company_memberships').insert({
    user_id: userId,
    company_id: companyId,
    role: 'company_admin',
  });
}

beforeAll(async () => {
  await (await import('./__helpers__/assert-test-db.js')).assertPointedAtTestDb();
  if (!dbReachable) return;
  await runMigrations();
});

beforeEach(async () => {
  if (!dbReachable) return;
  await seed();
});

afterAll(async () => {
  if (dbReachable) await db.destroy();
});

async function getTokenForIdentifier(identifier: string): Promise<string | null> {
  // The plaintext token never touches the DB, so the integration test
  // needs to intercept it via a monkey-patch of crypto. Instead, we
  // simulate a consume by looking up the row's token_hash and
  // re-issuing the token: we can't, since hash is one-way. Workaround
  // for test-only visibility: request the link, then read the hash
  // and mint a matching plaintext via a side channel. Not possible
  // cleanly. Instead: for consume tests, we create the DB row directly
  // with a known hash, bypassing requestMagicLink.
  void identifier;
  return null;
}
void getTokenForIdentifier;

describe.skipIf(!dbReachable)('magic-links service', () => {
  it('getMagicLinkOptions reflects appliance EmailIt + Twilio presence', async () => {
    const { encryptSecret } = await import('../crypto.js');

    // No EmailIt, no Twilio seeded.
    const before = await getMagicLinkOptions();
    expect(before.emailEnabled).toBe(false);
    expect(before.smsEnabled).toBe(false);

    // Seed appliance-wide EmailIt with a real AES-GCM envelope so
    // getResolvedEmailit can decrypt it.
    await db('appliance_settings')
      .where({ id: 1 })
      .update({
        emailit_api_key_encrypted: encryptSecret('fake-api-key'),
        emailit_from_email: 'ops@test.local',
      });
    // Seed company-level Twilio. The auth token is never decrypted in
    // the options check — only presence matters — so the blob shape
    // doesn't need to be valid, just non-null.
    await db('company_settings')
      .where({ company_id: companyId })
      .update({
        twilio_account_sid: 'ACxxx',
        twilio_auth_token_encrypted: encryptSecret('fake-twilio-token'),
        twilio_from_number: '+15555550100',
      });

    const after = await getMagicLinkOptions();
    expect(after.emailEnabled).toBe(true);
    expect(after.smsEnabled).toBe(true);
  });

  it('requestMagicLink creates a row for an existing user by email', async () => {
    await requestMagicLink({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: '127.0.0.1',
      userAgent: 'test/1.0',
    });

    const rows = await db('magic_links').where({ user_id: userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.channel).toBe('email');
    expect(rows[0]!.identifier).toBe('admin@test.local');
    expect(rows[0]!.consumed_at).toBeNull();

    // Audit trail recorded.
    const audit = await db('auth_events').where({
      user_id: userId,
      event_type: 'magic_link_requested',
    });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('requestMagicLink is a silent no-op for unknown identifiers (no enumeration)', async () => {
    await requestMagicLink({
      identifier: 'ghost@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });
    const rows = await db('magic_links');
    expect(rows).toHaveLength(0);
  });

  it('requestMagicLink rate-limits to 3 per hour per identifier', async () => {
    for (let i = 0; i < 5; i++) {
      await requestMagicLink({
        identifier: 'admin@test.local',
        channel: 'email',
        origin: 'https://test.local',
        ip: null,
        userAgent: null,
      });
    }
    const rows = await db('magic_links').where({ user_id: userId });
    expect(rows).toHaveLength(3);
  });

  it('consumeMagicLink rejects an unknown token', async () => {
    await expect(
      consumeMagicLink({ token: 'nope-does-not-exist-12345', ip: null, userAgent: null }),
    ).rejects.toThrow(/Invalid or expired/);
  });

  it('consumeMagicLink single-uses a valid token and rejects replay', async () => {
    // Directly insert a row with a known token hash so we don't need
    // plaintext visibility into requestMagicLink.
    const crypto = await import('node:crypto');
    const token = 'test-token-that-is-long-enough-for-the-schema-1234';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db('magic_links').insert({
      token_hash: hash,
      user_id: userId,
      channel: 'email',
      identifier: 'admin@test.local',
      expires_at: new Date(Date.now() + 60_000),
    });

    const session = await consumeMagicLink({ token, ip: null, userAgent: null });
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.user.email).toBe('admin@test.local');

    // Second use of the same token must fail.
    await expect(consumeMagicLink({ token, ip: null, userAgent: null })).rejects.toThrow(
      /Invalid or expired/,
    );
  });

  it('consumeMagicLink rejects an expired token', async () => {
    const crypto = await import('node:crypto');
    const token = 'expired-token-long-enough-for-schema-1234567890';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db('magic_links').insert({
      token_hash: hash,
      user_id: userId,
      channel: 'email',
      identifier: 'admin@test.local',
      expires_at: new Date(Date.now() - 60_000),
    });

    await expect(consumeMagicLink({ token, ip: null, userAgent: null })).rejects.toThrow(
      /Invalid or expired/,
    );
  });

  it('requestMagicLink via SMS finds a user through employees.phone', async () => {
    // Create an employee with phone + user_id link. The phone has
    // to be verified — the SMS lookup now requires phone_verified_at
    // IS NOT NULL so an unverified number can't hijack future
    // magic-link requests.
    await db('employees').insert({
      company_id: companyId,
      user_id: userId,
      first_name: 'Admin',
      last_name: 'User',
      phone: '+15555550199',
      phone_verified_at: new Date(),
      status: 'active',
    });

    await requestMagicLink({
      identifier: '+15555550199',
      channel: 'sms',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });

    const rows = await db('magic_links').where({ user_id: userId, channel: 'sms' });
    expect(rows).toHaveLength(1);
  });

  // -------------------------------------------------------------------
  // Password reset
  // -------------------------------------------------------------------

  it('requestPasswordReset mints a 30-minute password_reset token', async () => {
    const before = Date.now();
    await requestPasswordReset({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });

    const rows = await db('magic_links').where({ user_id: userId });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.purpose).toBe('password_reset');
    expect(rows[0]!.initiated_by_user_id).toBeNull();

    // 30-minute TTL, not the 15 a login link gets. Generous bounds so a
    // slow CI box doesn't flake the assertion.
    const ttlMs = new Date(rows[0]!.expires_at).getTime() - before;
    expect(ttlMs).toBeGreaterThan(29 * 60_000);
    expect(ttlMs).toBeLessThan(31 * 60_000);

    const audit = await db('auth_events').where({
      user_id: userId,
      event_type: 'password_reset_requested',
    });
    expect(audit.length).toBe(1);
  });

  it('requestPasswordReset is silent for unknown identifiers', async () => {
    await requestPasswordReset({
      identifier: 'ghost@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });
    expect(await db('magic_links')).toHaveLength(0);
  });

  it('login and reset share one 3-per-hour self-service budget', async () => {
    // Two of each. The fourth request onward must be dropped
    // regardless of which flow asked — otherwise alternating between
    // the two endpoints doubles the ceiling.
    await requestMagicLink({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });
    await requestPasswordReset({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });
    await requestMagicLink({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });
    await requestPasswordReset({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });

    expect(await db('magic_links').where({ user_id: userId })).toHaveLength(3);
  });

  it('consumeMagicLink accepts a password_reset token like any other', async () => {
    const crypto = await import('node:crypto');
    const token = 'reset-token-long-enough-for-the-schema-1234567';
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    await db('magic_links').insert({
      token_hash: hash,
      user_id: userId,
      channel: 'email',
      purpose: 'password_reset',
      identifier: 'admin@test.local',
      expires_at: new Date(Date.now() + 60_000),
    });

    const session = await consumeMagicLink({ token, ip: null, userAgent: null });
    expect(session.accessToken).toBeTruthy();

    // Must be tagged as magic_link so /auth/set-password will accept a
    // new password without the old one — that tag is the entire
    // mechanism behind the reset landing page.
    const claims = JSON.parse(
      Buffer.from(session.accessToken.split('.')[1]!, 'base64url').toString('utf8'),
    );
    expect(claims.authMethod).toBe('magic_link');
  });

  // -------------------------------------------------------------------
  // Admin-initiated sends
  // -------------------------------------------------------------------

  it('sendAccountLink records the acting admin and reports an outcome', async () => {
    const result = await sendAccountLink({
      targetUserId: userId,
      channel: 'email',
      purpose: 'login',
      origin: 'https://test.local',
      actorUserId: userId,
      ip: null,
      userAgent: null,
    });

    expect(result.channel).toBe('email');
    expect(result.purpose).toBe('login');
    // Masked, never the raw address.
    expect(result.sentTo).not.toBe('admin@test.local');
    expect(result.sentTo).toContain('@test.local');

    const rows = await db('magic_links').where({ user_id: userId });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.initiated_by_user_id)).toBe(userId);
  });

  it('admin sends do not consume the self-service rate-limit budget', async () => {
    // Four admin-initiated sends — well past the 3/hour self-service
    // cap — must not stop the user from requesting their own link.
    for (let i = 0; i < 4; i++) {
      await sendAccountLink({
        targetUserId: userId,
        channel: 'email',
        purpose: 'login',
        origin: 'https://test.local',
        actorUserId: userId,
        ip: null,
        userAgent: null,
      });
    }
    await requestMagicLink({
      identifier: 'admin@test.local',
      channel: 'email',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });

    const selfService = await db('magic_links')
      .where({ user_id: userId })
      .whereNull('initiated_by_user_id');
    expect(selfService).toHaveLength(1);
  });

  it('sendAccountLink refuses SMS when no phone at all exists', async () => {
    await expect(
      sendAccountLink({
        targetUserId: userId,
        channel: 'sms',
        purpose: 'login',
        origin: 'https://test.local',
        actorUserId: userId,
        ip: null,
        userAgent: null,
      }),
    ).rejects.toThrow(/No phone number on file/);

    // Nothing was minted — a token we can't deliver would just pollute
    // the audit trail.
    expect(await db('magic_links')).toHaveLength(0);
  });

  it('sendAccountLink texts an UNVERIFIED employee number and flags it', async () => {
    // The new-hire case: an employee can't verify a phone until they
    // can sign in, and this text is how they sign in. Admin-initiated
    // sends therefore accept an unconfirmed number — the admin picked
    // the recipient by identity, not by typing a number into a public
    // lookup — but the caller is told so it can warn about typos.
    await db('employees').insert({
      company_id: companyId,
      user_id: userId,
      first_name: 'New',
      last_name: 'Hire',
      phone: '+15555550188',
      phone_verified_at: null,
      status: 'active',
    });

    const result = await sendAccountLink({
      targetUserId: userId,
      channel: 'sms',
      purpose: 'login',
      origin: 'https://test.local',
      actorUserId: userId,
      ip: null,
      userAgent: null,
    });

    expect(result.phoneUnverified).toBe(true);
    expect(result.sentTo).toBe('•••-••88');
    const rows = await db('magic_links').where({ user_id: userId, channel: 'sms' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).toBe('+15555550188');
  });

  it('self-service SMS still requires a verified number', async () => {
    // The loosening above is scoped to admin-initiated sends. In the
    // public lookup the number IS the lookup key, so an unverified one
    // must never resolve to an account.
    await db('employees').insert({
      company_id: companyId,
      user_id: userId,
      first_name: 'New',
      last_name: 'Hire',
      phone: '+15555550166',
      phone_verified_at: null,
      status: 'active',
    });

    await requestMagicLink({
      identifier: '+15555550166',
      channel: 'sms',
      origin: 'https://test.local',
      ip: null,
      userAgent: null,
    });

    expect(await db('magic_links')).toHaveLength(0);
  });

  it('sendAccountLink finds a verified phone on the employee record', async () => {
    await db('employees').insert({
      company_id: companyId,
      user_id: userId,
      first_name: 'Admin',
      last_name: 'User',
      phone: '+15555550177',
      phone_verified_at: new Date(),
      status: 'active',
    });

    const result = await sendAccountLink({
      targetUserId: userId,
      channel: 'sms',
      purpose: 'password_reset',
      origin: 'https://test.local',
      actorUserId: userId,
      ip: null,
      userAgent: null,
    });

    expect(result.sentTo).toBe('•••-••77');
    const rows = await db('magic_links').where({ user_id: userId, channel: 'sms' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier).toBe('+15555550177');
    expect(rows[0]!.purpose).toBe('password_reset');
  });
});
