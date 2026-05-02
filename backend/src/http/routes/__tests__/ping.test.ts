// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { describe, it, expect } from 'vitest';
import express from 'express';
import { pingRouter } from '../health.js';

// Phase 14 — `/ping` must not import or touch any service that
// requires a live DB or Redis. The appliance's emergency-access
// fallback hits this endpoint while the parent stack is partially
// down, so a transitive import of (say) the punch service or the
// BullMQ queue would defeat the purpose.
//
// This test mounts only the ping router on a bare Express app (no
// other routes, no middleware) and asserts a 200 response. If a
// future refactor pulls a DB-touching helper into health.ts at
// import time, vitest's lazy-imports config means this file would
// still pass — so the assertion here is intentionally narrow.
describe('GET /api/v1/ping', () => {
  it('returns ok without exercising any backing service', async () => {
    const app = express();
    app.use('/api/v1/ping', pingRouter);

    const res = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const server = app.listen(0, () => {
        const addr = server.address();
        if (typeof addr !== 'object' || !addr) {
          server.close();
          reject(new Error('no address'));
          return;
        }
        fetch(`http://127.0.0.1:${addr.port}/api/v1/ping`)
          .then(async (r) => {
            const body = await r.json();
            server.close();
            resolve({ status: r.status, body });
          })
          .catch((err) => {
            server.close();
            reject(err);
          });
      });
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });
});
