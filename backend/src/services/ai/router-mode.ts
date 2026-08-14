// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
/**
 * Vibe AI Router mode (dual-mode per the router-option addendum, Q-063/Q-064).
 *
 * VIBE_AI_MODE=router sends all AI traffic through the appliance's Vibe AI Router:
 * the app stops choosing providers and models (task class is the only knob; router
 * policy decides the rest), per-company provider settings become inert, and cost /
 * audit / scrubbing move to the router. VIBE_AI_MODE=direct (the default) is the
 * standing single-install behavior — this app also ships standalone, where no
 * router exists, so direct is a first-class mode, not a legacy scaffold.
 *
 * There is NO silent cross-mode fallback: a router outage in router mode surfaces
 * as an error. Quietly retrying against a direct provider would ship the raw prompt
 * around the router's scrubber and ledger, which is worse than failing.
 */
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { VERSION } from '../../version.js';
import {
  VibeAiClient,
  VibeAiError,
  type ChatMessage,
  type RequestOptions,
} from './vibe-ai-client.js';
import { ProviderError, type CompletionInput, type LLMResponse } from './provider.js';

/** Task classes this app declares. New keys start local_only on the router (SSNs + wages). */
export const ROUTER_TASK_CLASSES = {
  NL_CORRECTION: 'payroll_nl_correction',
  SUPPORT_CHAT: 'payroll_support_chat',
} as const;

export type AiMode = 'direct' | 'router';

let modeOverride: AiMode | undefined;

export function aiMode(): AiMode {
  return modeOverride ?? env.VIBE_AI_MODE;
}

/** test seam — env is zod-parsed and frozen at import, so tests can't flip it */
export function _setAiModeForTests(m: AiMode | undefined): void {
  modeOverride = m;
}

let client: VibeAiClient | undefined;

export function routerClient(): VibeAiClient {
  if (!client) {
    // env.ts refuses to boot in router mode without these — the assertions hold.
    client = new VibeAiClient({
      baseUrl: env.VIBE_AI_ROUTER_URL as string,
      token: env.VIBE_AI_TOKEN as string,
    });
  }
  return client;
}

/** test seam */
export function _setRouterClientForTests(c: VibeAiClient | undefined): void {
  client = c;
}

/** Pure: this app's CompletionInput → router wire shapes. Exported for tests. */
export function toRouterRequest(input: CompletionInput): {
  messages: ChatMessage[];
  options: Pick<RequestOptions, 'maxTokens' | 'tools'>;
} {
  return {
    messages: [
      { role: 'system', content: input.system },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
    options: {
      maxTokens: input.maxTokens ?? 2048,
      ...(input.tools && input.tools.length > 0
        ? {
            tools: input.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            })),
          }
        : {}),
    },
  };
}

/** Pure: router tool-call arguments arrive as a JSON string; this app uses objects. */
export function parseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Complete through the router. Returns the app's LLMResponse shape plus the model
 * the router policy actually served (for the usage row — the app didn't choose it).
 */
export async function completeViaRouter(
  taskClass: string,
  input: CompletionInput,
  attribution?: { userId?: string },
): Promise<LLMResponse & { model: string }> {
  const { messages, options } = toRouterRequest(input);
  try {
    const result = await routerClient().complete(taskClass, messages, {
      ...options,
      ...(attribution?.userId ? { userId: attribution.userId } : {}),
    });
    return {
      text: result.content,
      toolCalls: result.toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: parseToolArguments(tc.arguments),
      })),
      tokens: {
        prompt: result.usage.promptTokens,
        completion: result.usage.completionTokens,
      },
      model: result.model,
    };
  } catch (err) {
    if (err instanceof VibeAiError) {
      // preserve the router's status where it is meaningful to this app's route layer
      // (429 rate limit / budget, 4xx policy) and normalize server-side trouble to 502
      throw new ProviderError(
        `Vibe AI Router: ${err.message} (${err.code})`,
        err.status >= 500 ? 502 : err.status,
      );
    }
    throw new ProviderError(
      `Vibe AI Router unreachable: ${err instanceof Error ? err.message : 'unknown error'}`,
      503,
    );
  }
}

export type RouterRegistrationStatus = 'disabled' | 'pending' | 'registered' | 'failing';

export interface RouterRegistrationState {
  status: RouterRegistrationStatus;
  attempts: number;
  lastAttemptAt: string | null;
  registeredAt: string | null;
  lastError: { message: string; status: number | null; code: string | null } | null;
  nextRetryInMs: number | null;
}

const initialRegistrationState = (): RouterRegistrationState => ({
  status: 'disabled',
  attempts: 0,
  lastAttemptAt: null,
  registeredAt: null,
  lastError: null,
  nextRetryInMs: null,
});

let registration: RouterRegistrationState = initialRegistrationState();

/** Snapshot for /admin/health. `status: 'disabled'` in direct mode. */
export function getRouterRegistrationState(): RouterRegistrationState {
  return {
    ...registration,
    lastError: registration.lastError ? { ...registration.lastError } : null,
  };
}

/** test seam */
export function _resetRouterRegistrationForTests(): void {
  registration = initialRegistrationState();
}

/**
 * Declare this app's task classes at boot (idempotent, version-stamped). Registration
 * failure must NOT block boot — on the appliance, apps regularly start before the
 * router is healthy — so this retries in the background and logs until it lands.
 * Requests made before registration completes fail closed at the router (unknown
 * task class → 403), which is the correct interim behavior.
 *
 * 401/403 means the app token itself is bad (most often: minted for the wrong
 * identity — must be exactly 'vibe-payroll-time'). That only resolves through
 * operator action, so retries slow to 5 minutes — but never stop, so a router-side
 * fix recovers without an app restart. State is exposed via
 * getRouterRegistrationState() so /admin/health can surface a stuck registration.
 */
export function registerRouterTaskClasses(): void {
  if (aiMode() !== 'router') return;
  registration = { ...initialRegistrationState(), status: 'pending' };
  const tryOnce = async (): Promise<void> => {
    registration.attempts += 1;
    registration.lastAttemptAt = new Date().toISOString();
    try {
      const res = await routerClient().registerTaskClasses({
        app: 'vibe-payroll-time',
        version: VERSION,
        classes: [
          {
            key: ROUTER_TASK_CLASSES.NL_CORRECTION,
            description:
              'Natural-language timesheet corrections (tool calls proposing punch edits)',
            requires: { tools: true },
            defaultMaxTokens: 2048,
          },
          {
            key: ROUTER_TASK_CLASSES.SUPPORT_CHAT,
            description: 'Product support chat grounded in the bundled documentation corpus',
            defaultMaxTokens: 1024,
          },
        ],
      });
      registration.status = 'registered';
      registration.registeredAt = new Date().toISOString();
      registration.lastError = null;
      registration.nextRetryInMs = null;
      logger.info({ registered: res.registered }, 'vibe-ai-router task classes registered');
    } catch (err) {
      const authFailure = err instanceof VibeAiError && (err.status === 401 || err.status === 403);
      const delayMs = authFailure ? 300_000 : Math.min(60_000, 5_000 * registration.attempts);
      registration.status = 'failing';
      registration.lastError = {
        message: err instanceof Error ? err.message : String(err),
        status: err instanceof VibeAiError ? err.status : null,
        code: err instanceof VibeAiError ? err.code : null,
      };
      registration.nextRetryInMs = delayMs;
      logger.warn(
        { err, attempt: registration.attempts, retryInMs: delayMs },
        'vibe-ai-router task-class registration failed; will retry',
      );
      const timer = setTimeout(() => void tryOnce(), delayMs);
      timer.unref();
    }
  };
  void tryOnce();
}
