// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, pinFingerprint } from '../crypto.js';

describe('encryptSecret / decryptSecret', () => {
  it('roundtrips a UTF-8 secret', () => {
    const plaintext = 'AC1234567890_super-secret_🔐';
    const blob = encryptSecret(plaintext);
    expect(blob).toMatch(/^v1\./);
    expect(decryptSecret(blob)).toBe(plaintext);
  });

  it('produces a distinct ciphertext each call (IV randomness)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('fails closed on tampered ciphertext', () => {
    const blob = encryptSecret('integrity-check');
    const parts = blob.split('.');
    // Flip a single bit in the ciphertext segment.
    const tampered = [
      parts[0],
      parts[1],
      parts[2],
      (parts[3] as string).slice(0, -1) + ((parts[3] as string).endsWith('A') ? 'B' : 'A'),
    ].join('.');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects malformed blobs', () => {
    expect(() => decryptSecret('nope')).toThrow();
    expect(() => decryptSecret('v0.x.y.z')).toThrow();
  });
});

describe('pinFingerprint', () => {
  it('produces a stable 64-hex-char digest', () => {
    const a = pinFingerprint(1, '482910');
    const b = pinFingerprint(1, '482910');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differentiates PINs across companies', () => {
    expect(pinFingerprint(1, '482910')).not.toBe(pinFingerprint(2, '482910'));
  });

  it('differentiates distinct PINs in the same company', () => {
    expect(pinFingerprint(1, '482910')).not.toBe(pinFingerprint(1, '482911'));
  });
});
