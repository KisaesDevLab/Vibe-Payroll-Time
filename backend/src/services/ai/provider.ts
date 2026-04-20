/**
 * LLM provider abstraction. Three implementations ship in v1:
 *   - Anthropic (native tool use, streaming)
 *   - OpenAI-compatible (completion only, covers OpenAI, Together, LM Studio,
 *     any endpoint exposing /chat/completions)
 *   - Ollama (local; completion only)
 *
 * NL timesheet corrections require tool calling, so they only work against
 * Anthropic. The support chat works against any provider.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { AIProvider } from '@vibept/shared';

export interface ProviderConfig {
  provider: AIProvider;
  apiKey: string | null;
  model: string;
  baseUrl?: string | null;
}

export interface ToolDef {
  name: string;
  description: string;
  /** JSON schema for the tool's arguments. */
  input_schema: Record<string, unknown>;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  /** The assistant's free-text reply (empty when only tool calls). */
  text: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  tokens: {
    prompt: number;
    completion: number;
  };
}

export interface CompletionInput {
  system: string;
  messages: LLMMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}

/** Errors this module throws; the route layer maps to 5xx / 503. */
export class ProviderError extends Error {
  public readonly status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function complete(cfg: ProviderConfig, input: CompletionInput): Promise<LLMResponse> {
  switch (cfg.provider) {
    case 'anthropic':
      return completeAnthropic(cfg, input);
    case 'openai_compatible':
      return completeOpenAICompat(cfg, input);
    case 'ollama':
      return completeOllama(cfg, input);
    default: {
      const _exhaustive: never = cfg.provider;
      throw new ProviderError(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

async function completeAnthropic(
  cfg: ProviderConfig,
  input: CompletionInput,
): Promise<LLMResponse> {
  if (!cfg.apiKey) throw new ProviderError('Anthropic API key not configured', 503);
  const client = new Anthropic({
    apiKey: cfg.apiKey,
    ...(cfg.baseUrl ? { baseURL: cfg.baseUrl } : {}),
  });

  const response = await client.messages.create({
    model: cfg.model,
    max_tokens: input.maxTokens ?? 2048,
    system: input.system,
    messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(input.tools && input.tools.length > 0
      ? {
          tools: input.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input_schema as Anthropic.Messages.Tool['input_schema'],
          })),
        }
      : {}),
  });

  let text = '';
  const toolCalls: LLMResponse['toolCalls'] = [];
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
    else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: (block.input as Record<string, unknown>) ?? {},
      });
    }
  }

  return {
    text,
    toolCalls,
    tokens: {
      prompt: response.usage.input_tokens,
      completion: response.usage.output_tokens,
    },
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (raw fetch; no tool calling in v1)
// ---------------------------------------------------------------------------

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function completeOpenAICompat(
  cfg: ProviderConfig,
  input: CompletionInput,
): Promise<LLMResponse> {
  if (!cfg.apiKey) throw new ProviderError('OpenAI API key not configured', 503);
  const base = (cfg.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  if (input.tools && input.tools.length > 0) {
    throw new ProviderError('Tool calling is only supported on Anthropic in this release', 501);
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: input.maxTokens ?? 2048,
      messages: [
        { role: 'system', content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });
  if (!res.ok) {
    throw new ProviderError(`OpenAI-compatible backend: ${res.status} ${await res.text()}`, 502);
  }
  const body = (await res.json()) as OpenAIChatResponse;
  const text = body.choices?.[0]?.message?.content ?? '';
  return {
    text,
    toolCalls: [],
    tokens: {
      prompt: body.usage?.prompt_tokens ?? 0,
      completion: body.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Ollama (local; completion only)
// ---------------------------------------------------------------------------

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

async function completeOllama(cfg: ProviderConfig, input: CompletionInput): Promise<LLMResponse> {
  const base = (cfg.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
  if (input.tools && input.tools.length > 0) {
    throw new ProviderError('Tool calling is only supported on Anthropic in this release', 501);
  }
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      messages: [
        { role: 'system', content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      options: { num_predict: input.maxTokens ?? 2048 },
    }),
  });
  if (!res.ok) {
    throw new ProviderError(`Ollama: ${res.status} ${await res.text()}`, 502);
  }
  const body = (await res.json()) as OllamaChatResponse;
  return {
    text: body.message?.content ?? '',
    toolCalls: [],
    tokens: {
      prompt: body.prompt_eval_count ?? 0,
      completion: body.eval_count ?? 0,
    },
  };
}
