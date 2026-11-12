// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type {
  CurrentPunchResponse,
  KioskClockInRequest,
  KioskClockOutRequest,
  KioskClockOutResponse,
  KioskEmployeeContext,
  KioskMeResponse,
  KioskPunchRequest,
  KioskSwitchJobRequest,
  PairKioskRequest,
  PairKioskResponse,
  TimeEntry,
} from '@vibept/shared';
import { ApiError, apiFetch } from './api';
import { authStore } from './auth-store';
import { kioskStore } from './kiosk-store';

// Runtime API base — see src/lib/api.ts for the rationale.
const API_BASE = `${import.meta.env.BASE_URL}api/v1`;

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

function requireKiosk() {
  const k = kioskStore.get();
  if (!k) throw new ApiError(401, 'unauthorized', 'Kiosk not paired');
  return k;
}

interface KioskFetchOpts extends RequestInit {
  /** Kiosk employee session token (issued by /kiosk/verify-pin). */
  employeeSession?: string;
}

/** A kiosk request that hasn't answered in this long is treated as "the
 *  kiosk is offline" so the employee gets told, not a spinner. */
const KIOSK_TIMEOUT_MS = 10_000;

/**
 * True when a kiosk call failed because the server could not be reached —
 * no response, our timeout, a proxy saying the API is down, or the
 * service worker's offline 503 — as opposed to the server refusing it.
 */
export function isKioskUnreachable(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!(err instanceof ApiError)) return true;
  // No API envelope: a captive portal or proxy page, not our server.
  if (err.code === 'network_error') return true;
  return err.status === 502 || err.status === 503 || err.status === 504;
}

async function fetchJson<T>(path: string, init: KioskFetchOpts = {}): Promise<T> {
  const { employeeSession, ...rest } = init;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(rest.headers as Record<string, string> | undefined),
  };
  // Public endpoints (/kiosk/pair) don't require the device header; the
  // caller passes explicit headers in that case.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), KIOSK_TIMEOUT_MS);
  let res: Response;
  let body: Envelope<T> | null;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...rest,
      signal: ctrl.signal,
      headers: employeeSession
        ? { ...headers, 'x-kiosk-employee-session': employeeSession }
        : headers,
    });
    if (res.status === 204) return undefined as T;
    body = (await res.json().catch(() => null)) as Envelope<T> | null;
  } catch {
    throw new ApiError(0, 'network_error', 'Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || !body || 'error' in body) {
    const err = body && 'error' in body ? body.error : null;
    throw new ApiError(
      res.status,
      err?.code ?? 'network_error',
      err?.message ?? `Request failed: ${res.status}`,
    );
  }
  return body.data;
}

function deviceHeader(): Record<string, string> {
  return { 'x-kiosk-device-token': requireKiosk().deviceToken };
}

export const kioskApi = {
  pair: (body: PairKioskRequest) =>
    fetchJson<PairKioskResponse>('/kiosk/pair', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: () =>
    fetchJson<KioskMeResponse>('/kiosk/me', {
      method: 'GET',
      headers: deviceHeader(),
    }),

  verifyPin: (pin: string) =>
    fetchJson<KioskEmployeeContext>('/kiosk/verify-pin', {
      method: 'POST',
      headers: deviceHeader(),
      body: JSON.stringify({ pin }),
    }),

  scanBadge: (payload: string) =>
    fetchJson<KioskEmployeeContext>('/kiosk/scan', {
      method: 'POST',
      headers: deviceHeader(),
      body: JSON.stringify({ payload }),
    }),

  // Punch actions — each requires the employee session token minted by
  // verify-pin in the last ~5 minutes.
  clockIn: (session: string, body: KioskClockInRequest = {}) =>
    fetchJson<TimeEntry>('/kiosk/punch/clock-in', {
      method: 'POST',
      headers: deviceHeader(),
      employeeSession: session,
      body: JSON.stringify(body),
    }),

  /** Revoke this tablet's own device token server-side. */
  unpair: () =>
    fetchJson<void>('/kiosk/unpair', {
      method: 'POST',
      headers: deviceHeader(),
    }),

  clockOut: (session: string, body: KioskClockOutRequest = {}) =>
    fetchJson<KioskClockOutResponse>('/kiosk/punch/clock-out', {
      method: 'POST',
      headers: deviceHeader(),
      employeeSession: session,
      body: JSON.stringify(body),
    }),

  breakIn: (session: string, body: KioskPunchRequest = {}) =>
    fetchJson<TimeEntry>('/kiosk/punch/break-in', {
      method: 'POST',
      headers: deviceHeader(),
      employeeSession: session,
      body: JSON.stringify(body),
    }),

  breakOut: (session: string, body: KioskPunchRequest = {}) =>
    fetchJson<TimeEntry>('/kiosk/punch/break-out', {
      method: 'POST',
      headers: deviceHeader(),
      employeeSession: session,
      body: JSON.stringify(body),
    }),

  switchJob: (session: string, body: KioskSwitchJobRequest) =>
    fetchJson<TimeEntry>('/kiosk/punch/switch-job', {
      method: 'POST',
      headers: deviceHeader(),
      employeeSession: session,
      body: JSON.stringify(body),
    }),

  current: (session: string) =>
    fetchJson<CurrentPunchResponse>('/kiosk/punch/current', {
      method: 'GET',
      headers: deviceHeader(),
      employeeSession: session,
    }),
};

/**
 * A kiosk tablet must never carry a user's session: anyone walking up to
 * it would be signed in as that person. Called when pairing and whenever
 * the kiosk screen mounts. Revokes the refresh token best-effort, then
 * drops the session locally regardless. The user's offline punch queue
 * is left alone (it is keyed by user and waits for their next sign-in).
 */
export async function dropUserSessionForKiosk(): Promise<void> {
  const session = authStore.get();
  if (!session) return;
  authStore.set(null);
  try {
    await apiFetch('/auth/logout', {
      method: 'POST',
      anonymous: true,
      noRetry: true,
      timeoutMs: 5_000,
      headers: { authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
  } catch {
    /* offline or already expired — the local copy is gone either way */
  }
}
