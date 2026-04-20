import type { ChatRequest, ChatResponse } from '@vibept/shared';
import { loadCorpus } from './corpus.js';
import { recordTokenUsage, resolveProviderConfig } from './config.js';
import { complete } from './provider.js';
import { SUPPORT_CHAT_GUARDRAIL, sanitizeUserInput } from './sanitize.js';

export interface SupportChatActor {
  userId: number;
  companyId: number;
}

export async function supportChat(
  actor: SupportChatActor,
  body: ChatRequest,
): Promise<ChatResponse> {
  const cfg = await resolveProviderConfig(actor.companyId);
  const corpus = await loadCorpus();

  const system = `${SUPPORT_CHAT_GUARDRAIL}

DOCUMENTATION:
${corpus}`;

  const messages = body.messages.map((m) => ({
    role: m.role,
    content: sanitizeUserInput(m.content),
  }));

  const response = await complete(cfg, {
    system,
    messages,
    maxTokens: 1024,
  });

  await recordTokenUsage({
    companyId: actor.companyId,
    userId: actor.userId,
    feature: 'support_chat',
    provider: cfg.provider,
    model: cfg.model,
    promptTokens: response.tokens.prompt,
    completionTokens: response.tokens.completion,
  });

  return { reply: response.text };
}
