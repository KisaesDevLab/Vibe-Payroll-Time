import { describe, expect, it } from 'vitest';
import { computeState } from '../state.js';
import { LICENSE_GRACE_DAYS, LICENSE_TRIAL_DAYS } from '@vibept/shared';

const MS_PER_DAY = 86_400_000;

function makeClaims(expEpochSeconds: number) {
  return {
    iss: 'test',
    sub: 'vibept-appliance',
    appliance_id: 'test',
    company_slug: 'acme',
    tier: 'per_company_monthly' as const,
    iat: Math.floor(Date.now() / 1000),
    exp: expEpochSeconds,
  };
}

describe('computeState', () => {
  const created = new Date(Date.now() - 2 * MS_PER_DAY);

  // `isInternal` is only passed when computing the per-company resolver
  // view; the appliance row itself is never internal. Kept here to prove
  // the early-return still works for the company-scoped caller.
  it('short-circuits internal firms to internal_free', () => {
    const res = computeState({
      isInternal: true,
      license_expires_at: null,
      license_claims: null,
      created_at: created,
    });
    expect(res.state).toBe('internal_free');
    expect(res.expiresAt).toBeNull();
  });

  it('trial state while within the trial window, no license uploaded', () => {
    const res = computeState({
      license_expires_at: null,
      license_claims: null,
      created_at: new Date(Date.now() - 2 * MS_PER_DAY),
    });
    expect(res.state).toBe('trial');
    expect((res.daysUntilExpiry ?? 0) >= LICENSE_TRIAL_DAYS - 3).toBe(true);
  });

  it('grace state when trial just expired', () => {
    const res = computeState({
      license_expires_at: null,
      license_claims: null,
      created_at: new Date(Date.now() - (LICENSE_TRIAL_DAYS + 3) * MS_PER_DAY),
    });
    expect(res.state).toBe('grace');
  });

  it('expired state when past the grace window', () => {
    const res = computeState({
      license_expires_at: null,
      license_claims: null,
      created_at: new Date(Date.now() - (LICENSE_TRIAL_DAYS + LICENSE_GRACE_DAYS + 5) * MS_PER_DAY),
    });
    expect(res.state).toBe('expired');
  });

  it('licensed state while the stored claim exp is in the future', () => {
    const futureExp = Math.floor((Date.now() + 10 * MS_PER_DAY) / 1000);
    const res = computeState({
      license_expires_at: new Date(futureExp * 1000),
      license_claims: makeClaims(futureExp),
      created_at: created,
    });
    expect(res.state).toBe('licensed');
    expect(res.daysUntilExpiry).toBeGreaterThanOrEqual(9);
  });

  it('grace state for an expired licensed key within the grace window', () => {
    const pastExp = Math.floor((Date.now() - 5 * MS_PER_DAY) / 1000);
    const res = computeState({
      license_expires_at: new Date(pastExp * 1000),
      license_claims: makeClaims(pastExp),
      created_at: created,
    });
    expect(res.state).toBe('grace');
  });

  it('expired state for a licensed key past the grace window', () => {
    const longPastExp = Math.floor((Date.now() - (LICENSE_GRACE_DAYS + 10) * MS_PER_DAY) / 1000);
    const res = computeState({
      license_expires_at: new Date(longPastExp * 1000),
      license_claims: makeClaims(longPastExp),
      created_at: created,
    });
    expect(res.state).toBe('expired');
  });
});
