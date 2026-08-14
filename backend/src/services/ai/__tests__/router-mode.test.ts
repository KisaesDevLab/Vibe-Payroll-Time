// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetRouterRegistrationForTests,
  _setAiModeForTests,
  _setRouterClientForTests,
  completeViaRouter,
  getRouterRegistrationState,
  parseToolArguments,
  registerRouterTaskClasses,
  toRouterRequest,
} from '../router-mode.js';
import { VibeAiClient } from '../vibe-ai-client.js';
import { ProviderError } from '../provider.js';

/** VibeAiClient with fetch stubbed at the network edge — no real router needed. */
function clientAnswering(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): VibeAiClient {
  return new VibeAiClient({
    baseUrl: 'http://router.test:8220',
    token: 'vibe-test-token',
    fetch: (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      })) as typeof fetch,
  });
}

afterEach(() => {
  _setRouterClientForTests(undefined);
  _setAiModeForTests(undefined);
  _resetRouterRegistrationForTests();
  vi.useRealTimers();
});

/** Drain chained promise jobs (fetch stub + res.json are pure microtask work). */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

describe('toRouterRequest', () => {
  it('maps system + messages and translates Anthropic-style input_schema tools', () => {
    const { messages, options } = toRouterRequest({
      system: 'be terse',
      messages: [{ role: 'user', content: 'shift my punch' }],
      tools: [{ name: 'edit_entry', description: 'edit', input_schema: { type: 'object' } }],
      maxTokens: 512,
    });
    expect(messages[0]).toEqual({ role: 'system', content: 'be terse' });
    expect(messages[1]).toEqual({ role: 'user', content: 'shift my punch' });
    expect(options.maxTokens).toBe(512);
    expect(options.tools).toEqual([
      { name: 'edit_entry', description: 'edit', parameters: { type: 'object' } },
    ]);
  });

  it('omits tools when none are given and defaults maxTokens', () => {
    const { options } = toRouterRequest({ system: 's', messages: [] });
    expect(options.tools).toBeUndefined();
    expect(options.maxTokens).toBe(2048);
  });
});

describe('parseToolArguments', () => {
  it('parses the router wire format (JSON string) into this app object shape', () => {
    expect(parseToolArguments('{"entryId":7,"summary":"fix"}')).toEqual({
      entryId: 7,
      summary: 'fix',
    });
  });
  it('returns {} for junk rather than crashing the correction flow', () => {
    expect(parseToolArguments('not json')).toEqual({});
    expect(parseToolArguments('"a string"')).toEqual({});
  });
});

describe('completeViaRouter', () => {
  it('returns LLMResponse shape with the policy-served model and parsed tool calls', async () => {
    _setRouterClientForTests(
      clientAnswering(
        200,
        {
          model: 'ollama/qwen3:14b',
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  { id: 'tc1', function: { name: 'edit_entry', arguments: '{"entryId":3}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20 },
        },
        { 'x-request-id': 'req-1' },
      ),
    );
    const res = await completeViaRouter('payroll_nl_correction', {
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(res.model).toBe('ollama/qwen3:14b');
    expect(res.toolCalls).toEqual([{ id: 'tc1', name: 'edit_entry', arguments: { entryId: 3 } }]);
    expect(res.tokens).toEqual({ prompt: 100, completion: 20 });
  });

  it('maps router errors to ProviderError, preserving meaningful client statuses', async () => {
    _setRouterClientForTests(
      clientAnswering(
        429,
        { error: { code: 'rate_limited', message: 'slow down' } },
        { 'retry-after': '2' },
      ),
    );
    await expect(
      completeViaRouter('payroll_support_chat', { system: 's', messages: [] }),
    ).rejects.toSatisfy((e: unknown) => e instanceof ProviderError && e.status === 429);
  });

  it('maps router 5xx to a 502 ProviderError — and NEVER falls back to a direct provider', async () => {
    _setRouterClientForTests(clientAnswering(500, { error: { code: 'unknown', message: 'boom' } }));
    await expect(
      completeViaRouter('payroll_support_chat', { system: 's', messages: [] }),
    ).rejects.toSatisfy((e: unknown) => e instanceof ProviderError && e.status === 502);
  });

  it('maps network failure to 503 with a clear message', async () => {
    _setRouterClientForTests(
      new VibeAiClient({
        baseUrl: 'http://router.test:8220',
        token: 't',
        fetch: (async () => {
          throw new Error('ECONNREFUSED');
        }) as typeof fetch,
      }),
    );
    await expect(
      completeViaRouter('payroll_support_chat', { system: 's', messages: [] }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ProviderError && e.status === 503 && /unreachable/i.test(e.message),
    );
  });
});

describe('registerRouterTaskClasses state', () => {
  const successBody = {
    registered: [
      { key: 'payroll_nl_correction', created: false, sensitivity: 'local_only' },
      { key: 'payroll_support_chat', created: false, sensitivity: 'local_only' },
    ],
  };

  it('stays disabled in direct mode and never calls the router', async () => {
    let called = false;
    _setRouterClientForTests(
      new VibeAiClient({
        baseUrl: 'http://router.test:8220',
        token: 't',
        fetch: (async () => {
          called = true;
          return new Response(JSON.stringify(successBody), { status: 200 });
        }) as typeof fetch,
      }),
    );
    registerRouterTaskClasses();
    await flushMicrotasks();
    expect(getRouterRegistrationState()).toMatchObject({ status: 'disabled', attempts: 0 });
    expect(called).toBe(false);
  });

  it('records registered state on success', async () => {
    _setAiModeForTests('router');
    _setRouterClientForTests(clientAnswering(200, successBody));
    registerRouterTaskClasses();
    await flushMicrotasks();
    const state = getRouterRegistrationState();
    expect(state.status).toBe('registered');
    expect(state.attempts).toBe(1);
    expect(state.registeredAt).not.toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.nextRetryInMs).toBeNull();
  });

  it('captures a 403 (wrong token identity) and slows retries to 5 minutes', async () => {
    vi.useFakeTimers();
    _setAiModeForTests('router');
    _setRouterClientForTests(
      clientAnswering(403, { error: { code: 'auth_error', message: 'token identity mismatch' } }),
    );
    registerRouterTaskClasses();
    await flushMicrotasks();
    const state = getRouterRegistrationState();
    expect(state.status).toBe('failing');
    expect(state.attempts).toBe(1);
    expect(state.lastAttemptAt).not.toBeNull();
    expect(state.lastError).toMatchObject({ status: 403, code: 'auth_error' });
    expect(state.nextRetryInMs).toBe(300_000);
  });

  it('recovers to registered when a retry succeeds — no restart needed', async () => {
    vi.useFakeTimers();
    _setAiModeForTests('router');
    _setRouterClientForTests(
      clientAnswering(403, { error: { code: 'auth_error', message: 'token identity mismatch' } }),
    );
    registerRouterTaskClasses();
    await flushMicrotasks();
    expect(getRouterRegistrationState().status).toBe('failing');

    _setRouterClientForTests(clientAnswering(200, successBody));
    await vi.advanceTimersByTimeAsync(300_000);
    await flushMicrotasks();
    const state = getRouterRegistrationState();
    expect(state.status).toBe('registered');
    expect(state.attempts).toBe(2);
    expect(state.lastError).toBeNull();
  });

  it('uses linear backoff and a null status for network errors', async () => {
    vi.useFakeTimers();
    _setAiModeForTests('router');
    _setRouterClientForTests(
      new VibeAiClient({
        baseUrl: 'http://router.test:8220',
        token: 't',
        fetch: (async () => {
          throw new Error('ECONNREFUSED');
        }) as typeof fetch,
      }),
    );
    registerRouterTaskClasses();
    await flushMicrotasks();
    const state = getRouterRegistrationState();
    expect(state.status).toBe('failing');
    expect(state.lastError).toMatchObject({ status: null, code: null });
    expect(state.lastError?.message).toMatch(/ECONNREFUSED/);
    expect(state.nextRetryInMs).toBe(5_000);
  });
});
