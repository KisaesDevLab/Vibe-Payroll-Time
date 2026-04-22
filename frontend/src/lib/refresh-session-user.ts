// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AuthUser } from '@vibept/shared';
import { apiFetch } from './api';
import { authStore } from './auth-store';

/**
 * Refresh `authStore.session.user` from `/auth/me` whenever the app
 * boots with a cached session. The stored user payload is frozen at
 * last-login / last-refresh time — memberships and their `isEmployee`
 * flag don't update until one of those happens. If an admin changes
 * the user↔employee link on the server (which the backend does
 * automatically when emails match), a client that logged in before
 * that change stays stuck on the old flags until the 15-minute access
 * token expires and triggers a refresh.
 *
 * This one-shot fetch closes that gap: any page load with a valid
 * session pulls the current `memberships` shape so UI gates (e.g. the
 * TopBar "My time" link, the multi-company picker) reflect reality.
 *
 * Failures are silent — a network blip at boot shouldn't log the user
 * out; the existing cached session is better than none, and the next
 * apiFetch call will trigger the refresh dance if the token actually
 * went bad.
 */
export async function refreshSessionUser(): Promise<void> {
  const session = authStore.get();
  if (!session) return;
  try {
    const me = await apiFetch<AuthUser>('/auth/me');
    authStore.updateUser(me);
  } catch {
    // Leave the cached user as-is; apiFetch handles real auth failures.
  }
}
