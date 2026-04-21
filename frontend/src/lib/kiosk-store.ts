// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Tablet-local kiosk device token. Persisted in localStorage so a
 * relaunch of the PWA doesn't require re-pairing. This is separate from
 * the user session store — an admin signed-in on this device is
 * independent of the kiosk pairing.
 */

const KEY = 'vibept.kiosk';

export interface StoredKiosk {
  deviceToken: string;
  deviceId: number;
  deviceName: string;
  companyId: number;
  companyName: string;
  /** Cached at pair time; refreshed via GET /kiosk/me on load so an admin
   *  flipping `kiosk_auth_mode` propagates without re-pairing. Defaults to
   *  `pin` to preserve the Phase 4 behavior when the field is absent. */
  kioskAuthMode?: 'pin' | 'qr' | 'both';
}

type Listener = (kiosk: StoredKiosk | null) => void;

class KioskStore {
  private state: StoredKiosk | null = this.read();
  private listeners = new Set<Listener>();

  get(): StoredKiosk | null {
    return this.state;
  }

  set(next: StoredKiosk | null): void {
    this.state = next;
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
    for (const fn of this.listeners) fn(next);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private read(): StoredKiosk | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredKiosk;
      if (!parsed.deviceToken || !parsed.companyId) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

export const kioskStore = new KioskStore();
