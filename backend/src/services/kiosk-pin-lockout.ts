// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { KIOSK_BAD_PIN_LIMIT, KIOSK_BAD_PIN_LOCKOUT_SECONDS } from '@vibept/shared';

/**
 * Per-(deviceId) bad-PIN lockout. Keeps kiosk PIN entry from degenerating
 * into a brute force channel. State is in-memory because:
 *   - the appliance runs a single backend process
 *   - losing state on restart is acceptable (attacker loses their attempt
 *     count too, but the attacker would need to coordinate with a
 *     restart, which an admin can force as a rescue action).
 *
 * For a multi-process future, move this into a DB table keyed by
 * `kiosk_device_id` + `attempted_at`.
 */

interface Entry {
  failures: number;
  lockedUntil: number | null;
}

const state = new Map<number, Entry>();

// Periodic sweep to drop stale entries (once a minute).
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of state) {
    if (!entry.lockedUntil && entry.failures === 0) state.delete(id);
    if (entry.lockedUntil && entry.lockedUntil < now - 60_000) state.delete(id);
  }
}, 60_000).unref();

export function isDeviceLocked(deviceId: number): { locked: boolean; retryAfterMs: number } {
  const entry = state.get(deviceId);
  if (!entry?.lockedUntil) return { locked: false, retryAfterMs: 0 };
  const now = Date.now();
  if (entry.lockedUntil <= now) {
    // Lockout expired — clear and allow.
    state.set(deviceId, { failures: 0, lockedUntil: null });
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: entry.lockedUntil - now };
}

/** Record a bad PIN. Returns whether the device is now locked. */
export function recordBadPin(deviceId: number): { locked: boolean; retryAfterMs: number } {
  const existing = state.get(deviceId) ?? { failures: 0, lockedUntil: null };
  existing.failures += 1;
  if (existing.failures >= KIOSK_BAD_PIN_LIMIT) {
    existing.lockedUntil = Date.now() + KIOSK_BAD_PIN_LOCKOUT_SECONDS * 1000;
    existing.failures = 0;
  }
  state.set(deviceId, existing);
  return existing.lockedUntil
    ? { locked: true, retryAfterMs: existing.lockedUntil - Date.now() }
    : { locked: false, retryAfterMs: 0 };
}

export function recordGoodPin(deviceId: number): void {
  state.delete(deviceId);
}

/** For tests only. */
export function _resetState(): void {
  state.clear();
}
