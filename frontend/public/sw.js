// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Vibe Payroll Time — service worker stub.
 *
 * Phase 4: registration only (no caching, no offline punch queue). Phase 5
 * replaces this file with a Workbox-backed worker that:
 *   - precaches the app shell
 *   - queues POSTs to /api/v1/punch/* in IndexedDB when offline
 *   - flushes the queue on `sync` events
 *
 * Keep this file at /sw.js (root scope) so registration can control the
 * whole app, including kiosk and personal-device routes.
 */

self.addEventListener('install', () => {
  // Activate immediately on first install so the app picks up a worker
  // without requiring a second visit.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass-through fetch — no caching yet. Defining the handler makes the
// worker installable and gives Phase 5 a concrete hook to extend.
self.addEventListener('fetch', () => {
  // no-op
});
