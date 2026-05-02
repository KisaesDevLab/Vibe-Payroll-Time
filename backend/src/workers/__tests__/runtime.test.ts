// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, it, expect } from 'vitest';
import { startBackgroundJobs } from '../runtime.js';

// vitest.config.ts sets WORKERS_ENABLED=false. The runtime must
// short-circuit cleanly without ever importing Redis or BullMQ —
// otherwise tests would need a Redis fixture and standalone customers
// without Redis provisioned would fail to boot.
describe('startBackgroundJobs (WORKERS_ENABLED=false)', () => {
  it('returns a no-op handle when workers are disabled', async () => {
    const handle = await startBackgroundJobs();
    expect(handle).toHaveProperty('stop');
    await expect(handle.stop()).resolves.toBeUndefined();
  });

  it('is idempotent across multiple calls', async () => {
    const a = await startBackgroundJobs();
    const b = await startBackgroundJobs();
    await a.stop();
    await b.stop();
  });
});
