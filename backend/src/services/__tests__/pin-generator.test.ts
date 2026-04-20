import { describe, expect, it } from 'vitest';
import { isWeakPin, validatePinShape } from '../pin-generator.js';

describe('isWeakPin', () => {
  it('rejects all-same-digit PINs', () => {
    expect(isWeakPin('0000')).toBe(true);
    expect(isWeakPin('99999')).toBe(true);
    expect(isWeakPin('222222')).toBe(true);
  });

  it('rejects obvious sequential PINs', () => {
    expect(isWeakPin('1234')).toBe(true);
    expect(isWeakPin('123456')).toBe(true);
    expect(isWeakPin('654321')).toBe(true);
  });

  it('accepts non-obvious PINs', () => {
    expect(isWeakPin('4829')).toBe(false);
    expect(isWeakPin('836174')).toBe(false);
    expect(isWeakPin('091')).toBe(false); // short, but not weak on its own
  });
});

describe('validatePinShape', () => {
  it('requires 4–6 digits only', () => {
    expect(validatePinShape('482910')).toBe(true);
    expect(validatePinShape('4829')).toBe(true);
    expect(validatePinShape('482')).toBe(false); // too short
    expect(validatePinShape('4829103')).toBe(false); // too long
    expect(validatePinShape('4829a')).toBe(false); // non-digit
  });

  it('rejects weak patterns', () => {
    expect(validatePinShape('1234')).toBe(false);
    expect(validatePinShape('0000')).toBe(false);
  });
});
