// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AuthUser } from '@vibept/shared';
import { apiFetch } from './api';
import { authStore } from './auth-store';

/**
 * Single sign-on (Vibe Auth) — the browser half of the hand-off.
 *
 * Sessions here are bearer tokens in localStorage, not cookies, so the
 * server cannot "log the browser in" by itself. A successful SSO login
 * ends with a redirect to
 *
 *     <base>/login#sso_token=<access>&sso_refresh=<refresh>
 *
 * The pair rides the FRAGMENT because a fragment is never sent to a
 * server and never lands in an access log. They are the same two tokens
 * POST /auth/login mints, so they are stored the same way; the access
 * token additionally carries a `sid` claim, which is how the app later
 * knows the session came from SSO.
 */

/** Path prefix the app is served under, without the trailing slash:
 *  `` standalone, `/time` on the appliance. */
export const SSO_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface SsoFragment {
  accessToken: string;
  refreshToken: string;
}

/** Pure, so the parsing is tested. */
export function parseSsoFragment(hash: string): SsoFragment | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  const accessToken = params.get('sso_token')?.trim();
  const refreshToken = params.get('sso_refresh')?.trim();
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

/** Read a JWT's claims WITHOUT verifying it — the server verifies on
 *  every request; this only steers UI. Returns null for anything that is
 *  not a three-part token with a JSON payload. */
export function decodeJwtClaims(token: string): { exp?: number; sid?: string } | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='));
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' ? (claims as { exp?: number; sid?: string }) : null;
  } catch {
    return null;
  }
}

/** True when the access token came from a single sign-on login. Holds
 *  across refreshes: the server carries `sid` through token rotation. */
export function isSsoSession(accessToken: string | undefined): boolean {
  return !!accessToken && typeof decodeJwtClaims(accessToken)?.sid === 'string';
}

let handoffError: string | null = null;

/** Set when a hand-off arrived but could not be turned into a session;
 *  the login page shows it once. */
export function takeSsoHandoffError(): string | null {
  const e = handoffError;
  handoffError = null;
  return e;
}

/**
 * Called once at boot, before the first render, on whatever route the
 * redirect landed on. Scrubs the fragment immediately — it must survive in
 * neither history nor a copied link — then completes the session with the
 * user payload the rest of the app expects in the store.
 */
export async function consumeSsoHandoff(): Promise<void> {
  const tokens = parseSsoFragment(window.location.hash);
  if (!tokens) return;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);

  try {
    const user = await apiFetch<AuthUser>('/auth/me', {
      anonymous: true,
      noRetry: true,
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const exp = decodeJwtClaims(tokens.accessToken)?.exp;
    authStore.set({
      ...tokens,
      accessTokenExpiresAt: new Date(exp ? exp * 1000 : Date.now()).toISOString(),
      user,
    });
  } catch {
    handoffError = 'Single sign-on finished, but the session could not be loaded. Please retry.';
  }
}

/**
 * The SSO half of signing out: tells the server to drop the identity row
 * and the refresh chain behind this session (and write the audit entry).
 * `local=1` leaves the identity provider's own session alive — it is
 * shared with every other Vibe app the person has open. Best effort: the
 * caller clears the local session regardless.
 */
export async function ssoSignOut(accessToken: string): Promise<void> {
  try {
    await fetch(`${SSO_BASE_PATH}/auth/oidc/logout?local=1`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
    });
  } catch {
    /* ignore */
  }
}
