// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Vibe Payroll Time — service worker (Phase 14.3).
 *
 * Workbox-style hand-rolled cache + offline strategy. The build version
 * is baked in via the docker-entrypoint sed substitution (see
 * frontend/docker-entrypoint.d/50-build-version.sh) so a new release
 * activates a fresh cache and purges stale assets on the next page
 * load — without requiring vite-plugin-pwa or a Workbox toolchain.
 *
 * Route-family strategies (per addendum §5.2):
 *   - SPA navigations      network-first, cache fallback (avoids the
 *                          upgrade trap where a cached HTML references
 *                          asset chunks the new build no longer ships)
 *   - Static assets        cache-first long-lived (hashed filenames make
 *                          the cache safe — new builds get new URLs)
 *   - Roster / schedule    network-first 30s (kiosk needs freshest roster)
 *   - Punch POSTs          network-only (offline punches handled separately)
 *   - Everything else      pass-through
 *
 * Cross-origin requests bypass this worker entirely. If a customer
 * migrates from primary domain to a Tailscale URL, the SW on the new
 * origin is a fresh install — no stale cache from the old origin.
 *
 * The fetch handler ignores any non-GET request — POST/PUT/PATCH/DELETE
 * fall through to the network. The Phase 5 offline punch queue (when
 * shipped) plugs in on top of this and intercepts punch POSTs
 * specifically.
 */

const BUILD_VERSION = '__VIBE_BUILD_VERSION__';
const SHELL_CACHE = `payroll-time-shell-v${BUILD_VERSION}`;
const ASSET_CACHE = `payroll-time-assets-v${BUILD_VERSION}`;
const ROSTER_CACHE = `payroll-time-roster-v${BUILD_VERSION}`;
const VALID_CACHES = new Set([SHELL_CACHE, ASSET_CACHE, ROSTER_CACHE]);

const ROSTER_TTL_MS = 30_000;

self.addEventListener('install', () => {
  // Activate immediately on first install so the app picks up a worker
  // without requiring a second visit.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Take control of any open clients and purge caches from older
  // builds. Without this purge, an upgrade from v1.0.0 → v1.0.1 leaves
  // the v1.0.0 caches forever.
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith('payroll-time-') && !VALID_CACHES.has(name))
              .map((stale) => caches.delete(stale)),
          ),
        ),
    ]),
  );
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isAppShell(request, url) {
  // Top-level navigations (the user types /kiosk or /admin/timesheets)
  // resolve to index.html via the SPA nginx fallback. `request.mode`
  // distinguishes a document fetch from a sub-resource fetch reliably,
  // including for paths the SPA owns but doesn't have a static file
  // for. Also catch `/` and `/index.html` directly.
  if (request.mode === 'navigate') return true;
  if (url.pathname === '/' || url.pathname.endsWith('/index.html')) return true;
  return false;
}

function isStaticAsset(url) {
  return /\/assets\/.+\.(?:js|css|png|jpg|jpeg|svg|woff2?|webp|ico|map)$/i.test(url.pathname);
}

function isRosterFamily(url) {
  // Specifically the kiosk-tablet read endpoints that need
  // network-first behavior with a brief stale fallback. Keep this
  // matcher tight — caching anything employee-record or timesheet
  // related risks showing stale wages/hours data, which is an
  // audit-trail and wage-and-hour-claim hazard. The kiosk roster
  // (employees who can clock in) is the only data structurally safe
  // to cache for tens of seconds.
  return url.pathname === '/api/v1/kiosk/me' || url.pathname === '/api/v1/kiosk/roster';
}

function isPunchPost(request, url) {
  return request.method === 'POST' && url.pathname.startsWith('/api/v1/punch');
}

function isApiRequest(url) {
  return url.pathname.startsWith('/api/v1/') || url.pathname.startsWith('/api/');
}

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  // Stale-while-revalidate: serve cached immediately, update in
  // background. The next page load picks up the update.
  const networkPromise = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await networkPromise;
  if (fresh) return fresh;
  // Last-resort offline fallback for shell GETs — return a plain
  // 503 so the app boundary can render a "you're offline" state.
  return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
}

async function networkFirstNoTtl(cacheName, request) {
  // Used for SPA navigation requests. We always prefer the freshest
  // HTML so a deploy doesn't leave the user looking at an HTML
  // document that references chunks the new build no longer
  // includes. Cache is a fallback for the offline case only.
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

async function networkFirstWithStaleFallback(cacheName, request, ttlMs) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const stamped = fresh.clone();
      // Tag the cache entry with a fetch timestamp via a custom
      // header. We can't mutate Response in place; clone with extra
      // header.
      const tagged = new Response(await stamped.blob(), {
        status: stamped.status,
        statusText: stamped.statusText,
        headers: (() => {
          const h = new Headers(stamped.headers);
          h.set('x-vpt-cached-at', String(Date.now()));
          return h;
        })(),
      });
      cache.put(request, tagged).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (!cached) {
      return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
    }
    const cachedAt = Number(cached.headers.get('x-vpt-cached-at') ?? 0);
    if (cachedAt && Date.now() - cachedAt > ttlMs) {
      // Stale beyond TTL — let the caller decide; surface as 503 so
      // the kiosk UI can display a "roster is stale, retry" prompt
      // instead of silently rendering an out-of-date employee list.
      return new Response('stale', { status: 503, statusText: 'Stale Cache' });
    }
    return cached;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Only intercept same-origin GETs (and the punch POST passthrough).
  // Cross-origin requests (Twilio, LLM, etc.) go straight to network.
  if (!isSameOrigin(url)) return;

  // Punch POSTs always hit the network. Phase 5 will hook this slot
  // for the offline-queue → IndexedDB → background sync flow.
  if (isPunchPost(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== 'GET') return;

  // Navigation requests (the SPA shell at any URL) — network-first
  // with cache fallback. Network-first avoids the upgrade trap where
  // a cached HTML document references chunk filenames the new build
  // no longer ships; cache fallback keeps the kiosk loading offline
  // when wifi blips.
  if (isAppShell(request, url)) {
    event.respondWith(networkFirstNoTtl(SHELL_CACHE, request));
    return;
  }

  // API reads that are NOT in the kiosk-roster family bypass the
  // cache entirely. Caching arbitrary timesheet / payroll / audit
  // reads is a wage-and-hour-claim hazard — those endpoints must
  // always hit the live DB through the API.
  if (isApiRequest(url)) {
    if (isRosterFamily(url)) {
      event.respondWith(networkFirstWithStaleFallback(ROSTER_CACHE, request, ROSTER_TTL_MS));
    }
    return;
  }

  // Hashed JS / CSS / fonts / images served from /assets — long-lived
  // cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(ASSET_CACHE, request));
    return;
  }

  // Default: pass through (lets the network handle it; no caching).
});
