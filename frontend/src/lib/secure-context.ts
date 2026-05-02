// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.

/**
 * Phase 14.3 — detect whether the current page was loaded over a
 * secure context (HTTPS, or HTTP localhost/127.0.0.1 which browsers
 * also treat as secure).
 *
 * The appliance's emergency-access fallback exposes a plain HTTP
 * port (5192) for staff to do their jobs when Caddy is down. Service
 * workers, the PWA install prompt, camera access, and other
 * powerful APIs all silently no-op or fail over plain HTTP — the
 * UI must communicate that, not appear broken.
 *
 * Use `window.isSecureContext` as the canonical signal — it's the
 * exact predicate browsers use to gate the relevant APIs, so when
 * we hide an affordance based on it we hide it for the same
 * reasons the browser would.
 */
export function isSecureContext(): boolean {
  if (typeof window === 'undefined') return true;
  // SSR / test environments — no window means we can't decide. Be
  // permissive there; the gate runs in the browser anyway.
  if (typeof window.isSecureContext !== 'boolean') return true;
  return window.isSecureContext;
}
