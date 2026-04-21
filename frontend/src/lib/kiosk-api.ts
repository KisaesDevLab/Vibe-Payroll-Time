// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type {
  CurrentPunchResponse,
  KioskClockInRequest,
  KioskEmployeeContext,
  KioskMeResponse,
  KioskPunchRequest,
  KioskSwitchJobRequest,
  PairKioskRequest,
  PairKioskResponse,
  TimeEntry,
} from '@vibept/shared';
import { ApiError } from './api';
import { kioskStore } from './kiosk-store';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

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

async function fetchJson<T>(path: string, init: KioskFetchOpts = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  // Public endpoints (/kiosk/pair) don't require the device header; the
  // caller passes explicit headers in that case.
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init.employeeSession
      ? { ...headers, 'x-kiosk-employee-session': init.employeeSession }
      : headers,
  });
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
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

  clockOut: (session: string, body: KioskPunchRequest = {}) =>
    fetchJson<TimeEntry>('/kiosk/punch/clock-out', {
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
