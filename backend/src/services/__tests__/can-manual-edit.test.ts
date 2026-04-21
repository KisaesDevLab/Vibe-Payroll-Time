// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Pure unit tests for the manual-edit authorization matrix.
 * 12 combinations = (super_admin / company_admin / supervisor / employee) ×
 *                   (allowed / override_only / disabled mode) ×
 *                   (approved / unapproved period)
 * plus the "non-own employee entry" and "no membership" rejection paths.
 *
 * The service-layer logic has to agree with this matrix row-for-row;
 * that's why the function is pulled out of the service body and tested
 * in isolation here. Any change to the matrix gets traced here first.
 */
import { describe, expect, it } from 'vitest';
import { canManualEdit, type ManualEditActor, type ManualEditContext } from '../manual-entries.js';

function actor(
  roleGlobal: ManualEditActor['roleGlobal'],
  companyRole: ManualEditActor['companyRole'],
  isOwnEntry = true,
): ManualEditActor {
  return { roleGlobal, companyRole, isOwnEntry };
}

function ctx(
  mode: ManualEditContext['mode'],
  isApproved: ManualEditContext['isApproved'],
): ManualEditContext {
  return { mode, isApproved };
}

describe('canManualEdit — super_admin', () => {
  it.each([
    ['allowed', false],
    ['allowed', true],
    ['override_only', false],
    ['override_only', true],
    ['disabled', false],
    ['disabled', true],
  ] as const)('passes for mode=%s approved=%s', (mode, approved) => {
    const d = canManualEdit(actor('super_admin', null, false), ctx(mode, approved));
    expect(d.allowed).toBe(true);
  });
});

describe('canManualEdit — company_admin / supervisor', () => {
  it.each([
    ['company_admin', 'allowed', false],
    ['company_admin', 'allowed', true],
    ['company_admin', 'disabled', true],
    ['supervisor', 'allowed', false],
    ['supervisor', 'override_only', true],
    ['supervisor', 'disabled', true],
  ] as const)('%s passes regardless of mode/approval (%s/%s)', (role, mode, approved) => {
    const d = canManualEdit(actor('none', role), ctx(mode, approved));
    expect(d.allowed).toBe(true);
  });
});

describe('canManualEdit — employee', () => {
  it('allowed + unapproved + own → pass', () => {
    expect(canManualEdit(actor('none', 'employee', true), ctx('allowed', false)).allowed).toBe(
      true,
    );
  });
  it('override_only + unapproved + own → pass (create-time gate handles existence check)', () => {
    expect(
      canManualEdit(actor('none', 'employee', true), ctx('override_only', false)).allowed,
    ).toBe(true);
  });
  it('disabled + unapproved + own → reject', () => {
    const d = canManualEdit(actor('none', 'employee', true), ctx('disabled', false));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/disabled/i);
  });
  it('allowed + approved + own → reject', () => {
    const d = canManualEdit(actor('none', 'employee', true), ctx('allowed', true));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/approved/i);
  });
  it('allowed + unapproved + NOT own → reject', () => {
    const d = canManualEdit(actor('none', 'employee', false), ctx('allowed', false));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/own/i);
  });
});

describe('canManualEdit — no membership', () => {
  it('non-super_admin without membership → reject', () => {
    const d = canManualEdit(actor('none', null), ctx('allowed', false));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/membership/i);
  });
});
