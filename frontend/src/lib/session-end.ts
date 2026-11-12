// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT

/**
 * Why the server ended a session, for the sign-in page to show.
 *
 * A refresh refused with 403 means sign-in was turned off for this
 * person (every company switched it off), not that the session merely
 * expired; landing on a bare sign-in form that will refuse them again
 * explains nothing. `refreshSession` (lib/api.ts) notes the server's
 * message before clearing the session; LoginPage takes it once.
 *
 * sessionStorage so a reload of the sign-in page still shows it, and a
 * new tab doesn't.
 */

const KEY = 'vibept.sessionEndReason';

export function noteSessionEnded(reason: string): void {
  try {
    sessionStorage.setItem(KEY, reason);
  } catch {
    /* blocked storage — nothing to show */
  }
}

export function takeSessionEndReason(): string | null {
  try {
    const reason = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return reason || null;
  } catch {
    return null;
  }
}
