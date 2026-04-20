import type {
  KioskEmployeeContext,
  PairKioskRequest,
  PairKioskResponse,
} from '@vibept/shared';
import { ApiError } from './api';
import { kioskStore } from './kiosk-store';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

type Envelope<T> = { data: T } | { error: { code: string; message: string } };

async function fetchJson<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
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

export const kioskApi = {
  pair: (body: PairKioskRequest) =>
    fetchJson<PairKioskResponse>('/kiosk/pair', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /**
   * PIN verification attaches the device token. On success the tablet
   * receives a 5-minute `sessionToken` it uses for the subsequent punch
   * call (Phase 5 wires the actual punch mutation through the same
   * header).
   */
  verifyPin: async (pin: string): Promise<KioskEmployeeContext> => {
    const k = kioskStore.get();
    if (!k) throw new ApiError(401, 'unauthorized', 'Kiosk not paired');
    return fetchJson<KioskEmployeeContext>('/kiosk/verify-pin', {
      method: 'POST',
      headers: { 'x-kiosk-device-token': k.deviceToken },
      body: JSON.stringify({ pin }),
    });
  },
};
