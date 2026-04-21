// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import {
  KIOSK_BADGE_SCAN_LIMIT,
  KIOSK_BADGE_SCAN_LOCKOUT_SECONDS,
  KIOSK_BADGE_SCAN_WINDOW_SECONDS,
} from '@vibept/shared';

/**
 * Per-kiosk badge-scan rate limit. Same in-memory pattern as the bad-PIN
 * lockout — the appliance runs a single backend process and losing state
 * on restart is acceptable.
 *
 * The limit is counted as "any scan attempt" rather than "bad scan" so a
 * hostile device can't hammer us with rapid successful scans either.
 * 20 scans per 60 seconds is plenty for a shift change; the 21st trips a
 * 60-second cooldown.
 */

interface Entry {
  /** Unix ms timestamps of recent attempts inside the rolling window. */
  attempts: number[];
  lockedUntil: number | null;
}

const state = new Map<number, Entry>();

setInterval(() => {
  const now = Date.now();
  const windowStart = now - KIOSK_BADGE_SCAN_WINDOW_SECONDS * 1000;
  for (const [id, entry] of state) {
    entry.attempts = entry.attempts.filter((t) => t >= windowStart);
    if (entry.lockedUntil && entry.lockedUntil < now) entry.lockedUntil = null;
    if (entry.attempts.length === 0 && !entry.lockedUntil) state.delete(id);
  }
}, 60_000).unref();

export function isKioskBadgeLocked(deviceId: number): { locked: boolean; retryAfterMs: number } {
  const entry = state.get(deviceId);
  if (!entry?.lockedUntil) return { locked: false, retryAfterMs: 0 };
  const now = Date.now();
  if (entry.lockedUntil <= now) {
    entry.lockedUntil = null;
    entry.attempts = [];
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - now };
}

/**
 * Record an attempt. Returns lock state AFTER the attempt; callers that
 * should reject the current request check the `retryAfterMs` to surface
 * a cooldown to the UI.
 */
export function recordKioskBadgeScan(deviceId: number): {
  locked: boolean;
  retryAfterMs: number;
} {
  const now = Date.now();
  const entry = state.get(deviceId) ?? { attempts: [], lockedUntil: null };

  if (entry.lockedUntil && entry.lockedUntil > now) {
    state.set(deviceId, entry);
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }

  const windowStart = now - KIOSK_BADGE_SCAN_WINDOW_SECONDS * 1000;
  entry.attempts = entry.attempts.filter((t) => t >= windowStart);
  entry.attempts.push(now);

  if (entry.attempts.length > KIOSK_BADGE_SCAN_LIMIT) {
    entry.lockedUntil = now + KIOSK_BADGE_SCAN_LOCKOUT_SECONDS * 1000;
    entry.attempts = [];
    state.set(deviceId, entry);
    return { locked: true, retryAfterMs: entry.lockedUntil - now };
  }

  state.set(deviceId, entry);
  return { locked: false, retryAfterMs: 0 };
}

/** For tests only. */
export function _resetBadgeLockoutState(): void {
  state.clear();
}
