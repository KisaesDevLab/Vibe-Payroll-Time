// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearReturnTo,
  peekReturnTo,
  sanitizeReturnTo,
  storeReturnTo,
  takeReturnTo,
} from '../return-to';

describe('sanitizeReturnTo', () => {
  it.each([
    '/my-timesheet',
    '/companies/3/reports?period=2026-11-01',
    '/companies/3/timesheets#row-4',
    '/my-timesheet/week',
  ])('accepts in-app path %s', (p) => {
    expect(sanitizeReturnTo(p)).toBe(p);
  });

  it.each([
    ['protocol-relative', '//evil.example/x'],
    ['backslash variant', '/\\evil.example'],
    ['backslash later', '/foo\\bar'],
    ['absolute URL', 'https://evil.example/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['relative', 'companies/3'],
    ['empty', ''],
    ['newline smuggling', '/\n/evil.example'],
    ['tab smuggling', '/\t/evil.example'],
    ['root (nothing to return to)', '/'],
    ['login loop', '/login'],
    ['login loop with query', '/login?x=1'],
    ['break-glass', '/login/local'],
    ['firm sign-in', '/firm'],
    ['magic link callback', '/auth/magic?token=abc'],
    ['reset callback', '/auth/reset?token=abc'],
    ['kiosk', '/kiosk'],
    ['kiosk pairing', '/kiosk/pair'],
    ['setup', '/setup'],
  ])('rejects %s', (_label, p) => {
    expect(sanitizeReturnTo(p)).toBeNull();
  });

  it('rejects non-strings and absurd lengths', () => {
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo({ pathname: '/x' })).toBeNull();
    expect(sanitizeReturnTo(`/${'a'.repeat(3000)}`)).toBeNull();
  });

  it('does not treat a lookalike prefix as excluded', () => {
    expect(sanitizeReturnTo('/kiosks-report')).toBe('/kiosks-report');
    expect(sanitizeReturnTo('/companies/1/kiosks')).toBe('/companies/1/kiosks');
  });
});

describe('stored return path', () => {
  beforeEach(() => clearReturnTo());

  it('round-trips once', () => {
    storeReturnTo('/my-timesheet', 1_000);
    expect(peekReturnTo(2_000)).toBe('/my-timesheet');
    expect(takeReturnTo(2_000)).toBe('/my-timesheet');
    expect(takeReturnTo(2_000)).toBeNull();
  });

  it('never stores an unsafe path', () => {
    storeReturnTo('//evil.example', 1_000);
    expect(peekReturnTo(1_000)).toBeNull();
  });

  it('expires after 30 minutes', () => {
    storeReturnTo('/my-timesheet', 0);
    expect(peekReturnTo(29 * 60_000)).toBe('/my-timesheet');
    expect(peekReturnTo(31 * 60_000)).toBeNull();
  });

  it('re-checks a value tampered with in storage', () => {
    localStorage.setItem('vibept.returnTo', JSON.stringify({ path: '//evil', at: 0 }));
    expect(peekReturnTo(1)).toBeNull();
  });
});
