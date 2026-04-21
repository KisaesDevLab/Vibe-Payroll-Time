// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KIOSK_BADGE_SCAN_LIMIT } from '@vibept/shared';
import {
  _resetBadgeLockoutState,
  isKioskBadgeLocked,
  recordKioskBadgeScan,
} from '../kiosk-badge-lockout.js';

const DEVICE = 7;

describe('kiosk badge scan lockout', () => {
  beforeEach(() => {
    _resetBadgeLockoutState();
    vi.useRealTimers();
  });

  it('allows the limit number of scans without tripping', () => {
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT; i++) {
      const state = recordKioskBadgeScan(DEVICE);
      expect(state.locked).toBe(false);
    }
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(false);
  });

  it('trips on the limit + 1 attempt', () => {
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT; i++) recordKioskBadgeScan(DEVICE);
    const tripping = recordKioskBadgeScan(DEVICE);
    expect(tripping.locked).toBe(true);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(true);
  });

  it('subsequent scans while locked continue to report locked with a retry-after window', () => {
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    const during = recordKioskBadgeScan(DEVICE);
    expect(during.locked).toBe(true);
    expect(during.retryAfterMs).toBeGreaterThan(0);
    expect(during.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('releases after the cooldown window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));

    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(true);

    // Just past the 60-second cooldown.
    vi.setSystemTime(new Date('2026-04-20T12:01:01Z'));
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(false);
  });

  it('isolates state per-device', () => {
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(true);
    expect(isKioskBadgeLocked(DEVICE + 1).locked).toBe(false);
  });

  it('isolates state across many devices simultaneously', () => {
    // Simulate a busy appliance: 10 kiosks, 3 of them tripping the limit.
    for (let d = 1; d <= 10; d++) {
      for (let i = 0; i < 5; i++) recordKioskBadgeScan(d);
    }
    // Now devices 1-3 hammer past the limit.
    for (const d of [1, 2, 3]) {
      for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(d);
    }
    for (const d of [1, 2, 3]) {
      expect(isKioskBadgeLocked(d).locked).toBe(true);
    }
    for (const d of [4, 5, 6, 7, 8, 9, 10]) {
      expect(isKioskBadgeLocked(d).locked).toBe(false);
    }
  });

  it('sliding window: old attempts fall off so a slow scanner never trips', () => {
    vi.useFakeTimers();
    const start = new Date('2026-04-20T12:00:00Z');
    vi.setSystemTime(start);

    // 20 scans exactly at the boundary — no trip yet.
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT; i++) recordKioskBadgeScan(DEVICE);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(false);

    // 61 seconds later, the old attempts are outside the rolling window.
    vi.setSystemTime(new Date(start.getTime() + 61_000));

    // Another 20 scans — should still NOT trip because the earlier 20
    // have rolled off.
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT; i++) recordKioskBadgeScan(DEVICE);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(false);
  });

  it('retry-after decreases as time passes during a lockout', () => {
    vi.useFakeTimers();
    const start = new Date('2026-04-20T12:00:00Z');
    vi.setSystemTime(start);

    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    const initial = isKioskBadgeLocked(DEVICE).retryAfterMs;
    expect(initial).toBeGreaterThan(55_000);

    vi.setSystemTime(new Date(start.getTime() + 20_000));
    const later = isKioskBadgeLocked(DEVICE).retryAfterMs;
    expect(later).toBeLessThan(initial);
    expect(later).toBeGreaterThan(30_000);
  });

  it('re-trips after a release if the next burst is immediate', () => {
    vi.useFakeTimers();
    const start = new Date('2026-04-20T12:00:00Z');
    vi.setSystemTime(start);

    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(true);

    vi.setSystemTime(new Date(start.getTime() + 61_000));
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(false);

    // Immediately tripping again should work.
    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    expect(isKioskBadgeLocked(DEVICE).locked).toBe(true);
  });

  it('does not blow up under a large number of distinct devices', () => {
    // 1000 devices, each making 5 scans. Nothing should lock; no crash.
    for (let d = 1; d <= 1000; d++) {
      for (let i = 0; i < 5; i++) {
        const s = recordKioskBadgeScan(d);
        expect(s.locked).toBe(false);
      }
    }
  });

  it('recordKioskBadgeScan while already locked returns the same retry-after without resetting', () => {
    vi.useFakeTimers();
    const start = new Date('2026-04-20T12:00:00Z');
    vi.setSystemTime(start);

    for (let i = 0; i < KIOSK_BADGE_SCAN_LIMIT + 1; i++) recordKioskBadgeScan(DEVICE);
    const first = recordKioskBadgeScan(DEVICE).retryAfterMs;
    vi.setSystemTime(new Date(start.getTime() + 1_000));
    const second = recordKioskBadgeScan(DEVICE).retryAfterMs;
    // 1s elapsed, retry-after should have decreased by ~1000ms (not reset).
    expect(second).toBeLessThan(first);
    expect(first - second).toBeGreaterThanOrEqual(900);
    expect(first - second).toBeLessThan(1100);
  });
});
