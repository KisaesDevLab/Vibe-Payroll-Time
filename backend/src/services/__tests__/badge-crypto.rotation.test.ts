/**
 * Key-rotation smoke tests. Rotating the HMAC signing key must invalidate
 * every previously-issued payload. Exercised at the crypto layer so we
 * don't need a DB for these — they're quick and run in the default unit
 * test pass.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { _resetBadgeKeyCache, generateBadgeToken, verifyBadgeToken } from '../badge-crypto.js';

// env is a plain object from zod's safeParse; we can mutate its keys
// at test time and restore afterwards. The crypto module reads
// env.BADGE_SIGNING_SECRET at getSigningKey() call time (via the
// module-scope closure), so clearing the cache forces a fresh read.

type MutableEnv = { BADGE_SIGNING_SECRET?: string };
const mutableEnv = env as unknown as MutableEnv;

describe('BADGE_SIGNING_SECRET rotation', () => {
  const ORIGINAL = mutableEnv.BADGE_SIGNING_SECRET;

  beforeEach(() => {
    delete mutableEnv.BADGE_SIGNING_SECRET;
    _resetBadgeKeyCache();
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete mutableEnv.BADGE_SIGNING_SECRET;
    else mutableEnv.BADGE_SIGNING_SECRET = ORIGINAL;
    _resetBadgeKeyCache();
  });

  it('verifies against the same key it signed with', () => {
    mutableEnv.BADGE_SIGNING_SECRET = 'a'.repeat(64);
    _resetBadgeKeyCache();
    const { payload } = generateBadgeToken({ companyId: 1, employeeId: 1, badgeVersion: 1 });
    expect(verifyBadgeToken(payload)).not.toBeNull();
  });

  it('rotation invalidates every previously-signed payload', () => {
    mutableEnv.BADGE_SIGNING_SECRET = 'a'.repeat(64);
    _resetBadgeKeyCache();
    const oldPayload = generateBadgeToken({
      companyId: 1,
      employeeId: 1,
      badgeVersion: 1,
    }).payload;

    // Rotate.
    mutableEnv.BADGE_SIGNING_SECRET = 'b'.repeat(64);
    _resetBadgeKeyCache();

    expect(verifyBadgeToken(oldPayload)).toBeNull();

    // New payload under the new key works.
    const newPayload = generateBadgeToken({
      companyId: 1,
      employeeId: 1,
      badgeVersion: 1,
    }).payload;
    expect(verifyBadgeToken(newPayload)).not.toBeNull();
  });

  it('accepts the secret as hex (64 chars) OR raw text (≥32 chars)', () => {
    mutableEnv.BADGE_SIGNING_SECRET = 'f'.repeat(64);
    _resetBadgeKeyCache();
    const hex = generateBadgeToken({ companyId: 1, employeeId: 1, badgeVersion: 1 }).payload;
    expect(verifyBadgeToken(hex)).not.toBeNull();

    mutableEnv.BADGE_SIGNING_SECRET = 'not-hex-raw-utf8-at-least-32-chars-for-real-ok';
    _resetBadgeKeyCache();
    const raw = generateBadgeToken({ companyId: 1, employeeId: 1, badgeVersion: 1 }).payload;
    expect(verifyBadgeToken(raw)).not.toBeNull();

    // Cross-verify fails: hex-era payload won't verify under raw-era key.
    expect(verifyBadgeToken(hex)).toBeNull();
  });

  it('unset secret falls back to HKDF from SECRETS_ENCRYPTION_KEY', () => {
    // BADGE_SIGNING_SECRET was deleted in beforeEach. Default dev/test path.
    const { payload } = generateBadgeToken({ companyId: 1, employeeId: 1, badgeVersion: 1 });
    expect(verifyBadgeToken(payload)).not.toBeNull();
  });
});
