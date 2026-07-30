// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { ChatMessage, ChatRequest, ChatResponse } from '@vibept/shared';
import { loadCorpus } from './corpus.js';
import { assertAIEnabled, recordTokenUsage, resolveProviderConfig } from './config.js';
import { complete } from './provider.js';
import { aiMode, completeViaRouter, ROUTER_TASK_CLASSES } from './router-mode.js';
import { SUPPORT_CHAT_GUARDRAIL, sanitizeUserInput } from './sanitize.js';

export interface SupportChatActor {
  userId: number;
  companyId: number;
}

export async function supportChat(
  actor: SupportChatActor,
  body: ChatRequest,
): Promise<ChatResponse> {
  const corpus = await loadCorpus();

  const system = `${SUPPORT_CHAT_GUARDRAIL}

DOCUMENTATION:
${corpus}`;

  const messages = body.messages.map((m: ChatMessage) => ({
    role: m.role,
    content: sanitizeUserInput(m.content),
  }));

  const input = { system, messages, maxTokens: 1024 };
  let response: { text: string; tokens: { prompt: number; completion: number } };
  let providerUsed: Parameters<typeof recordTokenUsage>[0]['provider'];
  let modelUsed: string;

  if (aiMode() === 'router') {
    // company-level on/off still applies; provider/model choice is router policy's
    await assertAIEnabled(actor.companyId);
    const routed = await completeViaRouter(ROUTER_TASK_CLASSES.SUPPORT_CHAT, input, {
      userId: String(actor.userId),
    });
    response = routed;
    providerUsed = 'vibe_router';
    modelUsed = routed.model;
  } else {
    const cfg = await resolveProviderConfig(actor.companyId);
    response = await complete(cfg, input);
    providerUsed = cfg.provider;
    modelUsed = cfg.model;
  }

  await recordTokenUsage({
    companyId: actor.companyId,
    userId: actor.userId,
    feature: 'support_chat',
    provider: providerUsed,
    model: modelUsed,
    promptTokens: response.tokens.prompt,
    completionTokens: response.tokens.completion,
  });

  return { reply: response.text };
}
