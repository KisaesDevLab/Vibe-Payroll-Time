import { describe, expect, it } from 'vitest';
import { hashPassword, hashPin, verifyPassword, verifyPin } from '../passwords.js';

describe('password hashing', () => {
  it('roundtrips a password through hash/verify', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$2[aby]\$/); // bcrypt prefix
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces distinct hashes across invocations (salt varies)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-input', a)).toBe(true);
    expect(await verifyPassword('same-input', b)).toBe(true);
  });
});

describe('PIN hashing', () => {
  it('roundtrips a PIN through hash/verify', async () => {
    const hash = await hashPin('482910');
    expect(await verifyPin('482910', hash)).toBe(true);
    expect(await verifyPin('482911', hash)).toBe(false);
  });
});
