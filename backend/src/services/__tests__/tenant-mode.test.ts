// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, it, expect } from 'vitest';
import { getTenantModeInfo } from '../tenant-mode.js';

// Default test env (vitest.config.ts) doesn't set TENANT_MODE, so the
// zod schema's default — `multi` — applies. The boot-guard's DB-touch
// path is exercised by the appliance integration smoke; this unit
// test just pins the env-resolution surface so a future refactor that
// renames TENANT_MODE or FIRM_NAME breaks loudly.
describe('getTenantModeInfo', () => {
  it('returns multi mode by default in tests', () => {
    const info = getTenantModeInfo();
    expect(info.mode).toBe('multi');
  });

  it('exposes firmName as null when env is unset', () => {
    const info = getTenantModeInfo();
    // FIRM_NAME is not set in vitest.config.ts; the optional-string
    // helper resolves blank/undefined to undefined which we pass
    // through as null in the public type.
    expect(info.firmName).toBeNull();
  });
});
