// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AuthResponse, AuthUser } from '@vibept/shared';

/**
 * Lightweight token + user cache. Persisted in localStorage so a reload
 * restores the session. A real "secure cookie + CSRF" scheme is overkill
 * for a self-hosted appliance — the backend already scopes tokens to a
 * 15-minute access lifetime with rotating refresh.
 */

const STORAGE_KEY = 'vibept.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  user: AuthUser;
}

type Listener = (session: StoredSession | null) => void;

class AuthStore {
  private session: StoredSession | null = this.read();
  private listeners = new Set<Listener>();

  get(): StoredSession | null {
    return this.session;
  }

  set(session: AuthResponse | null): void {
    this.session = session ? { ...session } : null;
    if (this.session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.emit();
  }

  updateUser(user: AuthUser): void {
    if (!this.session) return;
    this.session = { ...this.session, user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.session));
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed.accessToken || !parsed.refreshToken) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.session);
  }
}

export const authStore = new AuthStore();
