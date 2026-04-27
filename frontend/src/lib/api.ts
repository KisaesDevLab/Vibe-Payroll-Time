// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { AuthResponse } from '@vibept/shared';
import { authStore } from './auth-store';

// Runtime API base — derived from import.meta.env.BASE_URL (which Vite
// fills from the runtime sentinel substituted by the web container's
// docker-entrypoint hook). Single-app boots BASE_URL=`/`, multi-app
// boots BASE_URL=`/payroll/`, so API_BASE becomes `/api/v1` or
// `/payroll/api/v1` without a rebuild. The previous build-time
// VITE_API_BASE_URL knob locked the image to one mode at build time —
// we now use one image for both.
const API_BASE = `${import.meta.env.BASE_URL}api/v1`;

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type EnvelopeOk<T> = { data: T; meta?: Record<string, unknown> };
type EnvelopeErr = { error: { code: string; message: string; details?: unknown } };

export interface ApiFetchOptions extends RequestInit {
  /** Skip attaching the bearer token even if a session is active. */
  anonymous?: boolean;
  /** Skip the 401→refresh retry dance. */
  noRetry?: boolean;
}

async function rawFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const headers = new Headers({
    'content-type': 'application/json',
    ...(opts.headers ? Object.fromEntries(new Headers(opts.headers).entries()) : {}),
  });

  const session = authStore.get();
  if (!opts.anonymous && session) {
    headers.set('authorization', `Bearer ${session.accessToken}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    credentials: 'include',
  });

  // 204 No Content is the idiomatic success response for delete /
  // confirm / etc. — body is empty by spec, which previously caused
  // this helper to mis-classify it as an error. Short-circuit: any
  // 2xx with no body is a void success.
  if (res.ok && (res.status === 204 || res.headers.get('content-length') === '0')) {
    return undefined as T;
  }

  const body = (await res.json().catch(() => null)) as EnvelopeOk<T> | EnvelopeErr | null;

  if (!res.ok || !body || 'error' in body) {
    const err = body && 'error' in body ? body.error : null;
    throw new ApiError(
      res.status,
      err?.code ?? 'network_error',
      err?.message ?? `Request failed: ${res.status}`,
      err?.details,
    );
  }

  return body.data;
}

/** Refresh is in flight — queue concurrent callers so we don't rotate twice. */
let inFlightRefresh: Promise<AuthResponse> | null = null;

async function refreshSession(): Promise<AuthResponse> {
  if (inFlightRefresh) return inFlightRefresh;
  const session = authStore.get();
  if (!session) throw new ApiError(401, 'unauthorized', 'no session');

  inFlightRefresh = rawFetch<AuthResponse>('/auth/refresh', {
    method: 'POST',
    anonymous: true,
    noRetry: true,
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
    .then((fresh) => {
      authStore.set(fresh);
      return fresh;
    })
    .catch((err) => {
      authStore.set(null);
      throw err;
    })
    .finally(() => {
      inFlightRefresh = null;
    });

  return inFlightRefresh;
}

/**
 * Primary API entry point. Attaches the bearer token, and on 401 transparently
 * rotates the refresh token once and retries the original request. Routes
 * that deliberately run unauthenticated (login, setup) pass `anonymous: true`.
 */
export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  try {
    return await rawFetch<T>(path, opts);
  } catch (err) {
    if (
      !(err instanceof ApiError) ||
      err.status !== 401 ||
      opts.noRetry ||
      opts.anonymous ||
      !authStore.get()
    ) {
      throw err;
    }

    try {
      await refreshSession();
    } catch {
      throw err;
    }
    return rawFetch<T>(path, { ...opts, noRetry: true });
  }
}
