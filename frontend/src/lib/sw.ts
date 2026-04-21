// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Registers the service worker in production. In dev the SW is skipped so
 * stale cached bundles don't fight Vite's HMR.
 *
 * Phase 4: SW is a stub; Phase 5 adds the offline punch queue.
 */

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silent — a failed SW registration shouldn't break the app. The
      // appliance runs fine without offline support; Phase 5 will make
      // this more critical.
    });
  });
}
