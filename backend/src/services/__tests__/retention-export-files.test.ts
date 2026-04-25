// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Locks in that the nightly retention sweep walks per-company export
 * subdirectories. payroll-exports/engine.ts writes CSVs to
 * `EXPORTS_DIR/<companyId>/<filename>`; the prior implementation only
 * iterated the top level of EXPORTS_DIR, where the only entries are
 * directories — `isFile()` returned false and the company subdirectories
 * were skipped, so on-disk export files were never pruned.
 *
 * This test creates a stale file inside a company subdirectory plus a
 * stale file in the legacy flat layout, ages both via `utimes`, runs the
 * sweep, and asserts both are gone — and that a fresh file is preserved.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { runRetentionSweep } from '../retention.js';

// `env` is parsed once at module-load; mutating `process.env` after the
// fact has no effect. Patch the cached value directly so retention.ts
// resolves the temp dir we just created. Restored in afterEach.
const ORIG_EXPORTS_DIR = env.EXPORTS_DIR;

describe('retention sweep — export files', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vibept-retention-'));
    (env as { EXPORTS_DIR: string }).EXPORTS_DIR = tmpRoot;
  });

  afterEach(async () => {
    (env as { EXPORTS_DIR: string }).EXPORTS_DIR = ORIG_EXPORTS_DIR;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('prunes stale files inside per-company subdirectories', async () => {
    const companyDir = path.join(tmpRoot, '42');
    await fs.mkdir(companyDir, { recursive: true });
    const staleNested = path.join(companyDir, 'gusto-2024-01-01-aaaa.csv');
    const freshNested = path.join(companyDir, 'gusto-2026-04-01-bbbb.csv');
    await fs.writeFile(staleNested, 'old');
    await fs.writeFile(freshNested, 'new');

    // Legacy flat layout — pre-companyId-subdir refactor. Sweep should
    // still handle these so an upgraded appliance with leftover flat
    // files cleans them up too.
    const staleFlat = path.join(tmpRoot, 'qbo_payroll-2024-02-02-cccc.csv');
    await fs.writeFile(staleFlat, 'old');

    // Backdate the two "stale" files past the 365-day retention window
    // (set to 366 days ago to leave headroom for clock skew on slow CI).
    const oldTs = new Date(Date.now() - 366 * 24 * 3600 * 1000);
    await fs.utimes(staleNested, oldTs, oldTs);
    await fs.utimes(staleFlat, oldTs, oldTs);

    await runRetentionSweep();

    // The fresh file in the company subdir survives.
    await expect(fs.access(freshNested)).resolves.toBeUndefined();
    // The stale files (both nested and legacy flat) are gone.
    await expect(fs.access(staleNested)).rejects.toThrow();
    await expect(fs.access(staleFlat)).rejects.toThrow();
  });
});
