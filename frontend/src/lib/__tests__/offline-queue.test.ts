// Copyright 2026 Kisaes LLC
// SPDX-License-Identifier: MIT
import type { AuthResponse } from '@vibept/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the IndexedDB primitives (jsdom has no IndexedDB).
vi.mock('../offline-queue-db', () => {
  const stores: Record<string, Map<number, Record<string, unknown>>> = {
    pending_punches: new Map(),
    rejected_punches: new Map(),
  };
  let nextId = 1;
  return {
    __stores: stores,
    __reset: () => {
      stores.pending_punches!.clear();
      stores.rejected_punches!.clear();
      nextId = 1;
    },
    idbGetAll: async (s: string) => [...stores[s]!.values()].map((v) => ({ ...v })),
    idbAdd: async (s: string, v: Record<string, unknown>) => {
      const id = nextId++;
      stores[s]!.set(id, { ...v, id });
      return id;
    },
    idbDelete: async (s: string, id: number) => {
      stores[s]!.delete(id);
    },
    idbMove: async (from: string, id: number, to: string, v: Record<string, unknown>) => {
      stores[from]!.delete(id);
      const nid = nextId++;
      stores[to]!.set(nid, { ...v, id: nid });
    },
  };
});

import { ApiError, apiFetch } from '../api';
import { authStore } from '../auth-store';
import * as db from '../offline-queue-db';
import {
  MAX_OFFLINE_AGE_MS,
  drainQueue,
  enqueuePunch,
  listPendingFor,
  listQueue,
  listRejectedFor,
  startQueueFlusher,
} from '../offline-queue';

const fake = db as unknown as {
  __reset: () => void;
  __stores: Record<string, Map<number, Record<string, unknown>>>;
};

function session(userId: number): AuthResponse {
  return {
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    user: { id: userId, email: `u${userId}@x.test`, roleGlobal: 'none', memberships: [] },
  } as unknown as AuthResponse;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
let route: Route;
const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
  Promise.resolve(route(String(input), init ?? {})),
);

beforeEach(() => {
  fake.__reset();
  authStore.set(null);
  fetchMock.mockClear();
  route = () => json(201, { data: { id: 1 } });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  authStore.set(null);
});

const punchCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/punch/'));

describe('offline queue', () => {
  it('tags each item with the user and company and the tap time', async () => {
    const tappedAt = new Date('2026-11-11T14:00:00.000Z');
    await enqueuePunch('/punch/clock-in', { companyId: 7 }, { userId: 3, companyId: 7, tappedAt });
    const [item] = await listQueue();
    expect(item).toMatchObject({ userId: 3, companyId: 7, queuedAt: tappedAt.toISOString() });
  });

  it('is not cleared when the user signs out (or another signs in)', async () => {
    authStore.set(session(1));
    route = () => {
      throw new TypeError('offline');
    };
    const stop = startQueueFlusher();
    try {
      await enqueuePunch('/punch/clock-in', { companyId: 1 }, { userId: 1, companyId: 1 });
      authStore.set(null);
      authStore.set(session(2));
      await drainQueue();
      expect(await listQueue()).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("never sends another user's punches", async () => {
    await enqueuePunch('/punch/clock-in', { companyId: 1 }, { userId: 1, companyId: 1 });
    authStore.set(session(2));
    const res = await drainQueue();
    expect(punchCalls()).toHaveLength(0);
    expect(res.remaining).toBe(0);
    expect(await listPendingFor(1)).toHaveLength(1);

    // …and sends them once their owner is back.
    authStore.set(session(1));
    await drainQueue();
    expect(punchCalls()).toHaveLength(1);
    const [, init] = punchCalls()[0]!;
    expect((init!.headers as Headers).get('authorization')).toBe('Bearer access-1');
    expect(JSON.parse(String(init!.body))).toMatchObject({ clientStartedAt: expect.any(String) });
    expect(await listQueue()).toHaveLength(0);
  });

  it('treats 401 as transient: stops and keeps the punch queued', async () => {
    authStore.set(session(1));
    await enqueuePunch('/punch/clock-in', { companyId: 1 }, { userId: 1, companyId: 1 });
    await enqueuePunch('/punch/clock-out', { companyId: 1 }, { userId: 1, companyId: 1 });
    route = (url) =>
      url.endsWith('/auth/refresh')
        ? json(503, { error: { code: 'unavailable', message: 'down' } })
        : json(401, { error: { code: 'unauthorized', message: 'expired' } });
    const res = await drainQueue();
    expect(res).toMatchObject({ flushed: 0, failed: 0, remaining: 2 });
    expect(punchCalls()).toHaveLength(1); // stopped after the first
    expect(await listRejectedFor(1)).toHaveLength(0);
    expect(authStore.get()?.user.id).toBe(1);
  });

  it('keeps going on 429 / 5xx later, without rejecting', async () => {
    authStore.set(session(1));
    await enqueuePunch('/punch/clock-in', { companyId: 1 }, { userId: 1, companyId: 1 });
    route = () => json(429, { error: { code: 'rate_limited', message: 'slow down' } });
    await drainQueue();
    expect(await listPendingFor(1)).toHaveLength(1);
    expect(await listRejectedFor(1)).toHaveLength(0);
  });

  it('keeps the punch queued when a captive portal answers with HTML', async () => {
    authStore.set(session(1));
    await enqueuePunch('/punch/clock-in', { companyId: 1 }, { userId: 1, companyId: 1 });
    route = () =>
      new Response('<html>Sign in to Wi-Fi</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    await drainQueue();
    expect(await listPendingFor(1)).toHaveLength(1);
    expect(await listRejectedFor(1)).toHaveLength(0);
  });

  it('does not sign out on a proxy 403 page without the API envelope', async () => {
    authStore.set(session(1));
    route = (url) =>
      url.endsWith('/auth/refresh')
        ? new Response('Forbidden', { status: 403 })
        : json(401, { error: { code: 'unauthorized', message: 'expired' } });
    await expect(apiFetch('/me/preferences')).rejects.toBeInstanceOf(ApiError);
    expect(authStore.get()?.user.id).toBe(1);
  });

  it("moves a 4xx refusal to the rejected store with the server's message", async () => {
    authStore.set(session(1));
    await enqueuePunch('/punch/clock-in', { companyId: 1 }, { userId: 1, companyId: 1 });
    await enqueuePunch('/punch/break-in', { companyId: 1 }, { userId: 1, companyId: 1 });
    let n = 0;
    route = () =>
      n++ === 0
        ? json(409, { error: { code: 'conflict', message: 'Already clocked in' } })
        : json(201, { data: { id: 2 } });
    const res = await drainQueue();
    expect(res).toMatchObject({ flushed: 1, failed: 1, remaining: 0 });
    const rejected = await listRejectedFor(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      endpoint: '/punch/clock-in',
      status: 409,
      code: 'conflict',
      message: 'Already clocked in',
      userId: 1,
    });
    expect(rejected[0]!.rejectedAt).toEqual(expect.any(String));
    // Only the owner sees it.
    expect(await listRejectedFor(2)).toHaveLength(0);
  });

  it('rejects punches older than the 72-hour window without sending them', async () => {
    authStore.set(session(1));
    const old = new Date(Date.now() - MAX_OFFLINE_AGE_MS - 60_000);
    await enqueuePunch(
      '/punch/clock-in',
      { companyId: 1 },
      { userId: 1, companyId: 1, tappedAt: old },
    );
    await drainQueue();
    expect(punchCalls()).toHaveLength(0);
    expect(await listQueue()).toHaveLength(0);
    expect((await listRejectedFor(1))[0]).toMatchObject({ code: 'offline_too_old' });
  });
});

describe('session refresh', () => {
  it('keeps the session when the refresh fails for network / 5xx / 429 reasons', async () => {
    for (const refresh of [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => json(502, { error: { code: 'bad_gateway', message: 'x' } }),
      () => json(429, { error: { code: 'rate_limited', message: 'x' } }),
    ]) {
      authStore.set(session(1));
      route = (url) =>
        url.endsWith('/auth/refresh')
          ? refresh()
          : json(401, { error: { code: 'unauthorized', message: 'expired' } });
      await expect(apiFetch('/me/preferences')).rejects.toBeInstanceOf(ApiError);
      expect(authStore.get()?.user.id).toBe(1);
    }
  });

  it('signs out when the server refuses the refresh token (4xx other than 408/429)', async () => {
    for (const status of [400, 401, 403, 404]) {
      authStore.set(session(1));
      route = (url) =>
        url.endsWith('/auth/refresh')
          ? json(status, { error: { code: 'unauthorized', message: 'revoked' } })
          : json(401, { error: { code: 'unauthorized', message: 'expired' } });
      await expect(apiFetch('/me/preferences')).rejects.toBeInstanceOf(ApiError);
      expect(authStore.get()).toBeNull();
    }
  });

  it('surfaces a transient refresh failure as transient so punches queue', async () => {
    authStore.set(session(1));
    route = (url) =>
      url.endsWith('/auth/refresh')
        ? json(503, { error: { code: 'unavailable', message: 'down' } })
        : json(401, { error: { code: 'unauthorized', message: 'expired' } });
    await expect(apiFetch('/punch/clock-in', { method: 'POST' })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('times out a hung request when asked to', async () => {
    authStore.set(session(1));
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: unknown, init?: RequestInit) =>
          new Promise((_r, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('t', 'AbortError')),
            ),
          ),
      ),
    );
    await expect(
      apiFetch('/punch/clock-in', { method: 'POST', timeoutMs: 20 }),
    ).rejects.toMatchObject({ status: 0, code: 'network_error' });
  });
});
