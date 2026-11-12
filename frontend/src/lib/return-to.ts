// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/**
 * Where to send someone after they sign in again.
 *
 * When a session ends under someone's feet (refresh rejected, token
 * revoked) the route guards send them to /login carrying the page they
 * were on in router state. LoginPage copies it here, so it survives a
 * magic link opened in a new tab, and the signed-in redirect takes it.
 * A deliberate Sign out clears it and, until the next sign-in, stops a
 * guard re-rendering on its way out from storing the page again
 * (`markSignedOut`): the order of the store update and the navigation
 * is React's business, not something to rely on.
 *
 * Only router-relative, same-origin paths are accepted: anything that
 * could leave the app (`//host`, `/\host`, a scheme) or loop back into
 * sign-in is dropped.
 */

const KEY = 'vibept.returnTo';
/** A stale path from yesterday's expiry should not hijack today's sign-in. */
const TTL_MS = 30 * 60 * 1000;

const EXCLUDED = ['/login', '/firm', '/setup', '/auth', '/kiosk'];

let signedOut = false;

/** A deliberate sign-out: forget the path and refuse new ones until the
 *  next sign-in takes (takeReturnTo). */
export function markSignedOut(): void {
  signedOut = true;
  clearReturnTo();
}

/** True between a deliberate sign-out and the next sign-in. */
export function isSignedOutDeliberately(): boolean {
  return signedOut;
}

export function sanitizeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > 2048) return null;
  if (value[0] !== '/') return null;
  // Protocol-relative (`//evil`) and the backslash variant browsers
  // normalize to it (`/\evil`).
  if (value[1] === '/' || value.includes('\\')) return null;
  // Control characters, including tabs and newlines browsers strip.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const path = value.split(/[?#]/, 1)[0]!.toLowerCase();
  if (path === '/') return null;
  if (EXCLUDED.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return value;
}

export function storeReturnTo(value: unknown, now = Date.now()): void {
  if (signedOut) return;
  const path = sanitizeReturnTo(value);
  if (!path) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ path, at: now }));
  } catch {
    /* blocked storage — sign-in still works, it just lands on / */
  }
}

/** The stored path, if fresh and still safe. Does not clear it. */
export function peekReturnTo(now = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > TTL_MS || now < parsed.at) {
      return null;
    }
    return sanitizeReturnTo(parsed.path);
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Called once a sign-in has landed: the path (if any) and the end of
 *  the signed-out state. */
export function takeReturnTo(now = Date.now()): string | null {
  const path = peekReturnTo(now);
  clearReturnTo();
  signedOut = false;
  return path;
}
