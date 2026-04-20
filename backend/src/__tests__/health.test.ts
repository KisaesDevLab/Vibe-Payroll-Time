import { describe, it, expect } from 'vitest';
import { VERSION, GIT_SHA } from '../version.js';

describe('version metadata', () => {
  it('exposes a version string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it('exposes a git sha', () => {
    expect(typeof GIT_SHA).toBe('string');
  });
});
