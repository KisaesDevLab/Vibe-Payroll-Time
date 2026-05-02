// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, it, expect } from 'vitest';
import { isOriginAllowed, parseAllowedOriginEntries, resolvePublicOrigin } from '../public-url.js';

describe('parseAllowedOriginEntries', () => {
  it('parses literal origins', () => {
    const entries = parseAllowedOriginEntries('https://a.com,https://b.com');
    expect(entries).toEqual([
      { kind: 'literal', value: 'https://a.com' },
      { kind: 'literal', value: 'https://b.com' },
    ]);
  });

  it('strips trailing slashes from literals', () => {
    const [first] = parseAllowedOriginEntries('https://a.com/');
    expect(first).toEqual({ kind: 'literal', value: 'https://a.com' });
  });

  it('parses regex entries delimited with slashes', () => {
    const entries = parseAllowedOriginEntries('/^https:\\/\\/.*\\.tailnet\\.ts\\.net$/');
    expect(entries).toHaveLength(1);
    const first = entries[0];
    if (!first || first.kind !== 'regex') throw new Error('expected regex entry');
    expect(first.value.test('https://demo.tailnet.ts.net')).toBe(true);
    expect(first.value.test('https://attacker.com')).toBe(false);
  });

  it('mixes literals and regex', () => {
    const entries = parseAllowedOriginEntries(
      'https://a.com,/^https:\\/\\/.*\\.example\\.com$/,https://b.com',
    );
    expect(entries.map((e) => e.kind)).toEqual(['literal', 'regex', 'literal']);
  });

  it('throws on invalid regex so a typo fails loud at boot', () => {
    expect(() => parseAllowedOriginEntries('/[unclosed/')).toThrow(/Invalid ALLOWED_ORIGIN regex/);
  });

  it('ignores empty entries', () => {
    const entries = parseAllowedOriginEntries('https://a.com,,,https://b.com');
    expect(entries).toHaveLength(2);
  });
});

describe('isOriginAllowed', () => {
  it('matches a literal exactly', () => {
    expect(isOriginAllowed('https://a.com', 'https://a.com,https://b.com')).toBe(true);
    expect(isOriginAllowed('https://c.com', 'https://a.com,https://b.com')).toBe(false);
  });

  it('matches via regex', () => {
    expect(
      isOriginAllowed('https://demo.tailnet.ts.net', '/^https:\\/\\/.*\\.tailnet\\.ts\\.net$/'),
    ).toBe(true);
    expect(isOriginAllowed('https://attacker.com', '/^https:\\/\\/.*\\.tailnet\\.ts\\.net$/')).toBe(
      false,
    );
  });

  it('strips trailing slash from candidate', () => {
    expect(isOriginAllowed('https://a.com/', 'https://a.com')).toBe(true);
  });
});

describe('resolvePublicOrigin', () => {
  const allowedOrigin = 'https://app.example.com,https://other.example.com';

  it('returns PUBLIC_URL when set', () => {
    const out = resolvePublicOrigin({
      publicUrl: 'https://canonical.example.com',
      allowedOrigin,
      clientOrigin: 'https://app.example.com',
      requestOrigin: 'https://internal.example.com',
    });
    expect(out).toBe('https://canonical.example.com');
  });

  it('strips trailing slash from PUBLIC_URL', () => {
    const out = resolvePublicOrigin({
      publicUrl: 'https://canonical.example.com/',
      allowedOrigin,
      clientOrigin: undefined,
      requestOrigin: 'https://internal.example.com',
    });
    expect(out).toBe('https://canonical.example.com');
  });

  it('falls back to client-supplied origin when on allowlist', () => {
    const out = resolvePublicOrigin({
      publicUrl: undefined,
      allowedOrigin,
      clientOrigin: 'https://app.example.com',
      requestOrigin: 'https://internal.example.com',
    });
    expect(out).toBe('https://app.example.com');
  });

  it('rejects client-supplied origin not on allowlist', () => {
    const out = resolvePublicOrigin({
      publicUrl: undefined,
      allowedOrigin,
      clientOrigin: 'https://attacker.example.com',
      requestOrigin: 'https://internal.example.com',
    });
    expect(out).toBe('https://internal.example.com');
  });

  it('falls back to request origin when client origin missing', () => {
    const out = resolvePublicOrigin({
      publicUrl: undefined,
      allowedOrigin,
      clientOrigin: undefined,
      requestOrigin: 'https://internal.example.com',
    });
    expect(out).toBe('https://internal.example.com');
  });
});
