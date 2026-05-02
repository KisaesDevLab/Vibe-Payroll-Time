// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Registers the service worker in production. In dev the SW is skipped
 * so stale cached bundles don't fight Vite's HMR.
 *
 * Phase 14.3 — also skipped over plain HTTP (the appliance's
 * emergency-access fallback at :5192). Browsers refuse to register
 * service workers outside a secure context, so attempting it logs a
 * cryptic console error and a UI banner is more useful than silent
 * failure. The skip mirrors the gate in components that surface
 * PWA-only affordances.
 */

import { isSecureContext } from './secure-context';

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  if (!isSecureContext()) return;

  window.addEventListener('load', () => {
    // Resolve against Vite's base so the SW registers correctly under a
    // multi-app prefix (e.g. /payroll/sw.js). Single-app builds get /sw.js.
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch(() => {
      // Silent — a failed SW registration shouldn't break the app. The
      // appliance runs fine without offline support; the visible-banner
      // path lives in components that read isSecureContext directly.
    });
  });
}
