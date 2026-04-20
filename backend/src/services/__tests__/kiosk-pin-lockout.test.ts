import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetState, isDeviceLocked, recordBadPin, recordGoodPin } from '../kiosk-pin-lockout.js';

const DEVICE = 42;

describe('kiosk PIN lockout', () => {
  beforeEach(() => {
    _resetState();
    vi.useRealTimers();
  });

  it('allows the first bad PIN without locking', () => {
    const state = recordBadPin(DEVICE);
    expect(state.locked).toBe(false);
    expect(isDeviceLocked(DEVICE).locked).toBe(false);
  });

  it('locks after the configured failure limit', () => {
    recordBadPin(DEVICE);
    recordBadPin(DEVICE);
    const third = recordBadPin(DEVICE);
    expect(third.locked).toBe(true);
    expect(isDeviceLocked(DEVICE).locked).toBe(true);
  });

  it('clears on good PIN', () => {
    recordBadPin(DEVICE);
    recordBadPin(DEVICE);
    recordGoodPin(DEVICE);
    expect(isDeviceLocked(DEVICE).locked).toBe(false);
  });

  it('releases after the lockout window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T12:00:00Z'));

    recordBadPin(DEVICE);
    recordBadPin(DEVICE);
    recordBadPin(DEVICE);
    expect(isDeviceLocked(DEVICE).locked).toBe(true);

    // Just past the 30-second window.
    vi.setSystemTime(new Date('2026-04-20T12:00:31Z'));
    expect(isDeviceLocked(DEVICE).locked).toBe(false);
  });
});
