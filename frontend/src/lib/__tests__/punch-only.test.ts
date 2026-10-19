// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { isPunchOnlyUser } from '../punch-only';

const m = (role: string, isEmployee: boolean) => ({ role, isEmployee });

describe('isPunchOnlyUser', () => {
  it('is true for an employee-only account', () => {
    expect(isPunchOnlyUser({ roleGlobal: 'none', memberships: [m('employee', true)] })).toBe(true);
    expect(
      isPunchOnlyUser({
        roleGlobal: 'none',
        memberships: [m('employee', true), m('employee', true)],
      }),
    ).toBe(true);
  });

  it('is false for anyone who manages something, or has no clock', () => {
    expect(isPunchOnlyUser({ roleGlobal: 'super_admin', memberships: [m('employee', true)] })).toBe(
      false,
    );
    expect(
      isPunchOnlyUser({
        roleGlobal: 'none',
        memberships: [m('employee', true), m('supervisor', true)],
      }),
    ).toBe(false);
    expect(isPunchOnlyUser({ roleGlobal: 'none', memberships: [m('employee', false)] })).toBe(
      false,
    );
    expect(isPunchOnlyUser({ roleGlobal: 'none', memberships: [] })).toBe(false);
  });
});
