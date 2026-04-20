import type { AISettings, UpdateAISettingsRequest } from '@vibept/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/knex.js';
import { Forbidden, NotFound } from '../../http/errors.js';
import { decryptSecret, encryptSecret } from '../crypto.js';
import type { ProviderConfig } from './provider.js';

interface AIRow {
  ai_enabled: boolean;
  ai_provider: ProviderConfig['provider'];
  ai_model: string | null;
  ai_api_key_encrypted: string | null;
  ai_base_url: string | null;
  ai_daily_correction_limit: number;
}

const DEFAULT_MODELS: Record<ProviderConfig['provider'], string> = {
  anthropic: 'claude-sonnet-4-6',
  openai_compatible: 'gpt-4o-mini',
  ollama: 'llama3.2:3b',
};

async function loadRow(companyId: number): Promise<AIRow> {
  const row = await db('company_settings').where({ company_id: companyId }).first<AIRow>();
  if (!row) throw NotFound('Company settings not found');
  return row;
}

export async function getAISettings(companyId: number): Promise<AISettings> {
  const row = await loadRow(companyId);
  return {
    aiEnabled: row.ai_enabled,
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    aiBaseUrl: row.ai_base_url,
    aiApiKeyConfigured: !!row.ai_api_key_encrypted,
    aiDailyCorrectionLimit: row.ai_daily_correction_limit,
  };
}

export async function updateAISettings(
  companyId: number,
  patch: UpdateAISettingsRequest,
): Promise<AISettings> {
  return db.transaction(async (trx) => {
    const updates: Partial<AIRow> & { updated_at?: unknown } = {
      updated_at: trx.fn.now(),
    };
    if (patch.aiEnabled !== undefined) updates.ai_enabled = patch.aiEnabled;
    if (patch.aiProvider !== undefined) updates.ai_provider = patch.aiProvider;
    if (patch.aiModel !== undefined) updates.ai_model = patch.aiModel;
    if (patch.aiBaseUrl !== undefined) updates.ai_base_url = patch.aiBaseUrl;
    if (patch.aiDailyCorrectionLimit !== undefined)
      updates.ai_daily_correction_limit = patch.aiDailyCorrectionLimit;
    if ('aiApiKey' in patch) {
      updates.ai_api_key_encrypted =
        patch.aiApiKey === null ? null : encryptSecret(patch.aiApiKey as string);
    }
    await trx('company_settings').where({ company_id: companyId }).update(updates);
    const fresh = await trx('company_settings').where({ company_id: companyId }).first<AIRow>();
    if (!fresh) throw new Error('settings vanished');
    return {
      aiEnabled: fresh.ai_enabled,
      aiProvider: fresh.ai_provider,
      aiModel: fresh.ai_model,
      aiBaseUrl: fresh.ai_base_url,
      aiApiKeyConfigured: !!fresh.ai_api_key_encrypted,
      aiDailyCorrectionLimit: fresh.ai_daily_correction_limit,
    };
  });
}

/**
 * Resolve the effective provider config for a company, falling back to
 * appliance env vars when the company hasn't configured its own key.
 * Throws 403 if AI is disabled for the company — callers should
 * check before invoking the provider.
 */
export async function resolveProviderConfig(companyId: number): Promise<ProviderConfig> {
  const row = await loadRow(companyId);
  if (!row.ai_enabled) throw Forbidden('AI features are disabled for this company');

  const apiKey = row.ai_api_key_encrypted
    ? decryptSecret(row.ai_api_key_encrypted)
    : (env.AI_API_KEY ?? null);

  return {
    provider: row.ai_provider,
    apiKey,
    model: row.ai_model ?? env.AI_MODEL ?? DEFAULT_MODELS[row.ai_provider] ?? 'claude-sonnet-4-6',
    baseUrl: row.ai_base_url ?? env.AI_BASE_URL ?? null,
  };
}

export async function dailyCorrectionLimit(companyId: number): Promise<number> {
  const row = await loadRow(companyId);
  return row.ai_daily_correction_limit;
}

/** Write a token-usage row for billing / admin visibility. */
export async function recordTokenUsage(input: {
  companyId: number;
  userId: number | null;
  feature: 'nl_correction' | 'support_chat';
  provider: ProviderConfig['provider'];
  model: string;
  promptTokens: number;
  completionTokens: number;
}): Promise<void> {
  await db('ai_token_usage').insert({
    company_id: input.companyId,
    user_id: input.userId,
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    prompt_tokens: input.promptTokens,
    completion_tokens: input.completionTokens,
  });
}
