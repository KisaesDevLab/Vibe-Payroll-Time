// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { AuthResponse } from '@vibept/shared';
import { authStore } from './auth-store';
import { noteSessionEnded } from './session-end';

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
  /** Abort the request after this many ms. Opt-in: exports, reports and AI
   *  chat legitimately run long. Punches use it so a hung connection falls
   *  through to the offline queue instead of spinning. */
  timeoutMs?: number;
}

/** True when an ApiError means "the server did not answer usefully right
 *  now" rather than "the server refused this": no response, a timeout, a
 *  response without our API envelope (captive portal, proxy error page),
 *  a 5xx, or rate limiting. */
export function isTransientError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true; // TypeError from fetch, AbortError, …
  if (err.code === 'network_error') return true;
  return err.status >= 500 || err.status === 408 || err.status === 429;
}

/** An AbortSignal that fires after `ms`, combined with the caller's own
 *  signal if any. Feature-detected: older Safari lacks AbortSignal.timeout
 *  and AbortSignal.any, and a missing method must not break every punch. */
function timeoutSignal(ms: number, outer?: AbortSignal | null): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(
    () => ctrl.abort(new DOMException('Request timed out', 'TimeoutError')),
    ms,
  );
  ctrl.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  if (outer) {
    if (outer.aborted) ctrl.abort(outer.reason);
    else outer.addEventListener('abort', () => ctrl.abort(outer.reason), { once: true });
  }
  return ctrl.signal;
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

  const { anonymous: _a, noRetry: _n, timeoutMs, ...init } = opts;
  const signal = timeoutMs ? timeoutSignal(timeoutMs, opts.signal) : opts.signal;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers,
      credentials: 'include',
    });
  } catch {
    // No response at all: offline, DNS, connection reset, or our timeout.
    throw new ApiError(0, 'network_error', 'Could not reach the server.');
  }

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
    timeoutMs: 15_000,
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
    .then((fresh) => {
      authStore.set(fresh);
      return fresh;
    })
    .catch((err) => {
      // Sign out only when the server rejected the refresh token. A network
      // error, timeout, 5xx or 429 says nothing about the token — keep the
      // session so the employee isn't bounced to /login (and so queued
      // offline punches can still drain once the server is back).
      // `network_error` = no API envelope: a proxy's or portal's error
      // page, not our server rejecting the token. Any other 4xx from our
      // server (401 bad/expired/revoked token, 403 sign-in off, 404 user
      // gone, 400 malformed token) is final; 408 and 429 mean "later".
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408 &&
        err.status !== 429 &&
        err.code !== 'network_error'
      ) {
        // 403 = sign-in turned off: tell the login page why.
        if (err.status === 403) noteSessionEnded(err.message);
        authStore.set(null);
      }
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
    } catch (refreshErr) {
      // A refresh that failed transiently is the more useful error: the
      // caller (e.g. the punch page) should treat it as "server
      // unreachable" and queue, not as a refusal.
      if (isTransientError(refreshErr)) throw refreshErr;
      throw err;
    }
    return rawFetch<T>(path, { ...opts, noRetry: true });
  }
}
