import type { AuthMethod } from '@vibept/shared';

/**
 * Client-side JWT payload decode — purely for UI branching, never for
 * authorization. The backend is the only place that verifies tokens;
 * this helper just extracts the unverified payload so the frontend
 * knows whether the current session was minted via password or
 * magic-link (which swaps the Change-Password form to a
 * Set-Password form without a current-password field).
 *
 * Any tampering with the token on the client only changes the UI — the
 * server still verifies on every request.
 */
export interface LocalAccessTokenClaims {
  sub: string;
  email: string;
  authMethod: AuthMethod;
  exp?: number;
}

export function decodeAccessToken(token: string | undefined | null): LocalAccessTokenClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64 for atob().
    const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const raw = JSON.parse(atob(padded)) as Record<string, unknown>;
    if (typeof raw.sub !== 'string' || typeof raw.email !== 'string') return null;
    const method = raw.authMethod === 'magic_link' ? 'magic_link' : 'password';
    return {
      sub: raw.sub,
      email: raw.email,
      authMethod: method,
      ...(typeof raw.exp === 'number' ? { exp: raw.exp } : {}),
    };
  } catch {
    return null;
  }
}
