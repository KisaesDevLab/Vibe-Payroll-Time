// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { PunchLocation, PunchLocationMode } from '@vibept/shared';

/**
 * One GPS fix at the moment of a punch — and only then. Nothing here runs
 * between punches, nothing watches position, and the company setting
 * gates whether the browser is asked at all.
 *
 * The fix rides along in the punch body (and in the offline queue
 * payload) exactly like `clientStartedAt`: client-supplied metadata the
 * server records but never trusts for anything that accepts or rejects
 * the punch.
 */

/** Fields the punch body carries. Both absent when the mode is `off`. */
export interface PunchLocationFields {
  location?: PunchLocation;
  locationStatus?: 'denied' | 'unavailable';
}

/** Thrown in `required` mode when no fix could be produced. The punch is
 *  not sent; the page shows `message` and the employee can retry. */
export class PunchLocationRequiredError extends Error {
  constructor(
    readonly reason: 'denied' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'PunchLocationRequiredError';
  }
}

/** Long enough for a cold GPS fix outdoors, short enough that an employee
 *  in a basement is not left staring at a spinner. */
const FIX_TIMEOUT_MS = 10_000;

/** A fix this recent is reused rather than re-acquired. */
const MAX_FIX_AGE_MS = 30_000;

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: FIX_TIMEOUT_MS,
      maximumAge: MAX_FIX_AGE_MS,
    });
  });
}

function isPermissionDenied(err: unknown): boolean {
  // GeolocationPositionError.PERMISSION_DENIED === 1. Compared by value
  // because the constructor is not constructible in every test runtime.
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 1;
}

/**
 * Resolve the fields to attach to a punch body for the given company
 * mode. Never rejects in `optional` mode: a denied prompt or a timeout
 * becomes a `locationStatus` the server records. In `required` mode the
 * same outcomes throw `PunchLocationRequiredError` so the caller can
 * refuse to send the punch.
 */
export async function capturePunchLocation(mode: PunchLocationMode): Promise<PunchLocationFields> {
  if (mode === 'off') return {};

  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    return failed(mode, 'unavailable');
  }

  try {
    const pos = await getPosition();
    const { latitude, longitude, accuracy } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return failed(mode, 'unavailable');
    }
    return {
      location: {
        lat: round6(latitude),
        lng: round6(longitude),
        accuracyM: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
      },
    };
  } catch (err) {
    return failed(mode, isPermissionDenied(err) ? 'denied' : 'unavailable');
  }
}

function failed(mode: PunchLocationMode, reason: 'denied' | 'unavailable'): PunchLocationFields {
  if (mode === 'required') {
    throw new PunchLocationRequiredError(
      reason,
      reason === 'denied'
        ? 'Your company requires a location with each punch. Allow location access for this site in your browser settings, then try again.'
        : "Your company requires a location with each punch, and your device couldn't get one. Move somewhere with a clearer view of the sky or better signal, then try again.",
    );
  }
  return { locationStatus: reason };
}

/** decimal(9,6) on the server; anything finer is noise. */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Map link for a recorded fix. OpenStreetMap needs no API key and works
 *  in every browser the PWA supports. */
export function mapLinkFor(loc: PunchLocation): string {
  return `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}`;
}

export function formatCoords(loc: PunchLocation): string {
  const coords = `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
  return loc.accuracyM == null ? coords : `${coords} (±${loc.accuracyM} m)`;
}
