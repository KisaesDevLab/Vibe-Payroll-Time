// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { afterEach, describe, expect, it } from 'vitest';
import {
  _setRouterClientForTests,
  completeViaRouter,
  parseToolArguments,
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

afterEach(() => _setRouterClientForTests(undefined));

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
