// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PunchLocationRequiredError,
  capturePunchLocation,
  formatCoords,
  mapLinkFor,
} from '../punch-location';

type Success = (pos: GeolocationPosition) => void;
type Failure = (err: { code: number; message: string }) => void;

function stubGeolocation(impl: (ok: Success, fail: Failure) => void) {
  const getCurrentPosition = vi.fn(impl);
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition },
  });
  return getCurrentPosition;
}

function fix(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return {
    coords: { latitude, longitude, accuracy },
    timestamp: Date.now(),
  } as unknown as GeolocationPosition;
}

afterEach(() => {
  // jsdom defines no geolocation by default; remove whatever a test added.
  delete (navigator as { geolocation?: unknown }).geolocation;
});

describe('capturePunchLocation', () => {
  it('never touches the browser when the mode is off', async () => {
    const spy = stubGeolocation(() => {
      throw new Error('should not be called');
    });
    await expect(capturePunchLocation('off')).resolves.toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('rounds a fix to six decimals and whole metres', async () => {
    stubGeolocation((ok) => ok(fix(40.71280123456, -74.00600987654, 12.4)));
    await expect(capturePunchLocation('optional')).resolves.toEqual({
      location: { lat: 40.712801, lng: -74.00601, accuracyM: 12 },
    });
  });

  it('asks for a fresh high-accuracy fix with a bounded timeout', async () => {
    const spy = stubGeolocation((ok) => ok(fix(1, 2, 3)));
    await capturePunchLocation('optional');
    expect(spy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true, timeout: 10_000 }),
    );
  });

  it('reports a refused prompt as denied in optional mode and still resolves', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1, message: 'User denied' }));
    await expect(capturePunchLocation('optional')).resolves.toEqual({
      locationStatus: 'denied',
    });
  });

  it('reports a timeout or missing provider as unavailable in optional mode', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 3, message: 'Timeout' }));
    await expect(capturePunchLocation('optional')).resolves.toEqual({
      locationStatus: 'unavailable',
    });

    delete (navigator as { geolocation?: unknown }).geolocation;
    await expect(capturePunchLocation('optional')).resolves.toEqual({
      locationStatus: 'unavailable',
    });
  });

  it('throws in required mode so the punch is not sent', async () => {
    stubGeolocation((_ok, fail) => fail({ code: 1, message: 'User denied' }));
    const err = await capturePunchLocation('required').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PunchLocationRequiredError);
    expect((err as PunchLocationRequiredError).reason).toBe('denied');
    expect((err as Error).message).toMatch(/requires a location/);
  });

  it('still returns the fix in required mode when one is available', async () => {
    stubGeolocation((ok) => ok(fix(51.5, -0.12, 8)));
    await expect(capturePunchLocation('required')).resolves.toEqual({
      location: { lat: 51.5, lng: -0.12, accuracyM: 8 },
    });
  });
});

describe('display helpers', () => {
  it('builds an OpenStreetMap link centred on the fix', () => {
    expect(mapLinkFor({ lat: 40.7128, lng: -74.006, accuracyM: 10 })).toBe(
      'https://www.openstreetmap.org/?mlat=40.7128&mlon=-74.006#map=17/40.7128/-74.006',
    );
  });

  it('formats coordinates with the accuracy radius when known', () => {
    expect(formatCoords({ lat: 40.7128, lng: -74.006, accuracyM: 10 })).toBe(
      '40.71280, -74.00600 (±10 m)',
    );
    expect(formatCoords({ lat: 40.7128, lng: -74.006, accuracyM: null })).toBe(
      '40.71280, -74.00600',
    );
  });
});
