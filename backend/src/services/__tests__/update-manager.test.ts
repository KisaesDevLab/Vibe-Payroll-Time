// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The service resolves its control dir from process.env.UPDATE_CONTROL_DIR.
// We point it at a tmp dir per test so nothing leaks between cases.
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibept-updater-'));
  process.env.UPDATE_CONTROL_DIR = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.UPDATE_CONTROL_DIR;
});

async function freshImport() {
  // Vitest caches modules; we reset so each test picks up the current
  // UPDATE_CONTROL_DIR value from process.env.
  await import('node:module');
  const mod = await import('../update-manager.js');
  return mod;
}

describe('update-manager', () => {
  it('readLastRun returns null when status.json is missing', async () => {
    const { readLastRun } = await freshImport();
    expect(readLastRun()).toBeNull();
  });

  it('readLastRun parses a well-formed status.json', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'status.json'),
      JSON.stringify({
        state: 'finished',
        outcome: 'success',
        message: 'update complete',
        pre_sha: 'aaa1111',
        post_sha: 'bbb2222',
        updated_at: '2026-04-20T12:00:00Z',
      }),
      'utf8',
    );
    const { readLastRun } = await freshImport();
    const last = readLastRun();
    expect(last?.state).toBe('finished');
    expect(last?.outcome).toBe('success');
    expect(last?.post_sha).toBe('bbb2222');
  });

  it('readLastRun returns null on malformed json (graceful, not throwing)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'status.json'), '{not json', 'utf8');
    const { readLastRun } = await freshImport();
    expect(readLastRun()).toBeNull();
  });

  it('isUpdateInProgress is true when request.json exists', async () => {
    fs.writeFileSync(path.join(tmpDir, 'request.json'), '{}', 'utf8');
    const { isUpdateInProgress } = await freshImport();
    expect(isUpdateInProgress()).toBe(true);
  });

  it('isUpdateInProgress is true when status=running', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'status.json'),
      JSON.stringify({ state: 'running' }),
      'utf8',
    );
    const { isUpdateInProgress } = await freshImport();
    expect(isUpdateInProgress()).toBe(true);
  });

  it('isUpdateInProgress is false when nothing is flagged', async () => {
    const { isUpdateInProgress } = await freshImport();
    expect(isUpdateInProgress()).toBe(false);
  });

  it('requestUpdate writes request.json with the actor payload', async () => {
    const { requestUpdate } = await freshImport();
    const out = await requestUpdate({ userId: 7, userEmail: 'admin@test.local' });
    expect(out.queued).toBe(true);

    const raw = fs.readFileSync(path.join(tmpDir, 'request.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.requested_by_user_id).toBe(7);
    expect(parsed.requested_by_email).toBe('admin@test.local');
    expect(parsed.requested_at).toBe(out.requestedAt);
  });

  it('requestUpdate rejects when an update is already in progress', async () => {
    fs.writeFileSync(path.join(tmpDir, 'request.json'), '{}', 'utf8');
    const { requestUpdate } = await freshImport();
    await expect(requestUpdate({ userId: 1, userEmail: 'x@y' })).rejects.toThrow(
      /already in progress/,
    );
  });

  it('requestUpdate throws updater_not_wired when volume is missing', async () => {
    const ghostDir = path.join(tmpDir, 'does-not-exist');
    process.env.UPDATE_CONTROL_DIR = ghostDir;
    const { requestUpdate } = await freshImport();
    await expect(requestUpdate({ userId: 1, userEmail: 'x@y' })).rejects.toMatchObject({
      message: /volume not mounted/,
    });
  });

  it('readLogChunk returns empty with offset 0 when no log exists', async () => {
    const { readLogChunk } = await freshImport();
    const chunk = readLogChunk(0);
    expect(chunk.content).toBe('');
    expect(chunk.nextOffset).toBe(0);
    expect(chunk.complete).toBe(true); // no in-progress, no log → done
  });

  it('readLogChunk returns content + advances offset', async () => {
    const logPath = path.join(tmpDir, 'log.txt');
    fs.writeFileSync(logPath, 'hello world\n', 'utf8');
    const { readLogChunk } = await freshImport();
    const chunk = readLogChunk(0);
    expect(chunk.content).toBe('hello world\n');
    expect(chunk.nextOffset).toBe(12);
    expect(chunk.complete).toBe(true);
  });

  it('readLogChunk picks up incremental writes from the last offset', async () => {
    const logPath = path.join(tmpDir, 'log.txt');
    fs.writeFileSync(logPath, 'first\n', 'utf8');
    const { readLogChunk } = await freshImport();
    let chunk = readLogChunk(0);
    expect(chunk.content).toBe('first\n');
    expect(chunk.nextOffset).toBe(6);

    fs.appendFileSync(logPath, 'second\n', 'utf8');
    chunk = readLogChunk(6);
    expect(chunk.content).toBe('second\n');
    expect(chunk.nextOffset).toBe(13);
  });

  it('readLogChunk marks complete=false while an update is in progress', async () => {
    fs.writeFileSync(path.join(tmpDir, 'log.txt'), 'x', 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'request.json'), '{}', 'utf8');
    const { readLogChunk } = await freshImport();
    const chunk = readLogChunk(0);
    expect(chunk.content).toBe('x');
    expect(chunk.complete).toBe(false);
  });

  it('readLogChunk handles log truncation (size < offset) by resetting', async () => {
    const logPath = path.join(tmpDir, 'log.txt');
    fs.writeFileSync(logPath, 'original content', 'utf8');
    const { readLogChunk } = await freshImport();
    readLogChunk(0);
    // Simulate a new run that truncates the log.
    fs.writeFileSync(logPath, 'tiny', 'utf8');
    const chunk = readLogChunk(100);
    expect(chunk.nextOffset).toBe(0);
    expect(chunk.content).toBe('');
  });

  it('getRunningVersion returns the build-time identifiers', async () => {
    const { getRunningVersion } = await freshImport();
    const v = getRunningVersion();
    expect(typeof v.version).toBe('string');
    expect(typeof v.gitSha).toBe('string');
    expect(typeof v.buildDate).toBe('string');
  });
});
