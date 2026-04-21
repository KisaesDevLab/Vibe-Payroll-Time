import type {
  ApplianceSettings,
  ApplianceSettingsSource,
  UpdateApplianceSettingsRequest,
} from '@vibept/shared';
import { db } from '../db/knex.js';
import { env } from '../config/env.js';
import { setLogLevel } from '../config/logger.js';
import { decryptSecret, encryptSecret } from './crypto.js';

/**
 * SuperAdmin-editable appliance configuration. DB value (on the
 * `appliance_settings` singleton row) wins; NULL falls through to the
 * matching process.env value so a fresh appliance with no UI config
 * keeps working from env alone.
 *
 * Consumers should call the `getResolved*` helpers rather than reading
 * env directly — that gives SuperAdmins a single source of truth they
 * can edit at runtime.
 */

const ROW_ID = 1;

interface ApplianceSettingsRow {
  id: number;
  emailit_api_key_encrypted: string | null;
  emailit_from_email: string | null;
  emailit_from_name: string | null;
  emailit_api_base_url: string | null;
  ai_provider: 'anthropic' | 'openai_compatible' | 'ollama' | null;
  ai_api_key_encrypted: string | null;
  ai_model: string | null;
  ai_base_url: string | null;
  retention_days: number | null;
  log_level: string | null;
  // SMS — appliance-wide fallback for companies that haven't set their
  // own provider. See services/notifications/service.ts:resolveSmsConfig.
  sms_provider: 'twilio' | 'textlinksms' | null;
  twilio_account_sid: string | null;
  twilio_auth_token_encrypted: string | null;
  twilio_from_number: string | null;
  textlinksms_api_key_encrypted: string | null;
  textlinksms_from_number: string | null;
  textlinksms_base_url: string | null;
}

async function loadRow(): Promise<ApplianceSettingsRow> {
  const row = await db('appliance_settings').where({ id: ROW_ID }).first<ApplianceSettingsRow>();
  if (!row) throw new Error('appliance_settings singleton row missing');
  return row;
}

// Pick the effective value + note where it came from. For strings, DB
// wins when non-null; env wins when DB is null and env is set.
function pick<T>(
  dbValue: T | null | undefined,
  envValue: T | null | undefined,
): { value: T | null; source: ApplianceSettingsSource } {
  if (dbValue !== null && dbValue !== undefined) return { value: dbValue, source: 'db' };
  if (envValue !== null && envValue !== undefined) return { value: envValue, source: 'env' };
  return { value: null, source: 'unset' };
}

// ---------- public resolvers (used by consumers — notifications, AI, retention cron, logger) ----------

export interface ResolvedEmailit {
  apiKey: string | null;
  fromEmail: string | null;
  fromName: string;
  apiBaseUrl: string;
}

/** Appliance-wide SMS — one of twilio/textlinksms, or null if neither
 *  is fully configured. Consumed by notifications/service.ts to resolve
 *  the effective provider for a given company. */
export interface ResolvedSmsProvider {
  provider: 'twilio' | 'textlinksms' | null;
  twilio: { accountSid: string; authToken: string; fromNumber: string } | null;
  textlinksms: { apiKey: string; fromNumber: string; baseUrl: string | null } | null;
}

export async function getResolvedSmsProvider(): Promise<ResolvedSmsProvider> {
  const row = await loadRow();
  let twilio: ResolvedSmsProvider['twilio'] = null;
  if (row.twilio_account_sid && row.twilio_auth_token_encrypted && row.twilio_from_number) {
    twilio = {
      accountSid: row.twilio_account_sid,
      authToken: decryptSecret(row.twilio_auth_token_encrypted),
      fromNumber: row.twilio_from_number,
    };
  }
  let textlinksms: ResolvedSmsProvider['textlinksms'] = null;
  if (row.textlinksms_api_key_encrypted && row.textlinksms_from_number) {
    textlinksms = {
      apiKey: decryptSecret(row.textlinksms_api_key_encrypted),
      fromNumber: row.textlinksms_from_number,
      baseUrl: row.textlinksms_base_url ?? null,
    };
  }
  // If the operator picked a provider but didn't finish filling creds,
  // we still expose the picked provider so resolveSmsConfig can fall
  // back to company creds. If they didn't pick anything, infer from
  // whichever provider has complete creds.
  let provider = row.sms_provider;
  if (!provider) {
    if (twilio) provider = 'twilio';
    else if (textlinksms) provider = 'textlinksms';
  }
  return { provider, twilio, textlinksms };
}

export async function getResolvedEmailit(): Promise<ResolvedEmailit> {
  const row = await loadRow();
  const apiKey = row.emailit_api_key_encrypted
    ? decryptSecret(row.emailit_api_key_encrypted)
    : (env.EMAILIT_API_KEY ?? null);
  return {
    apiKey,
    fromEmail: row.emailit_from_email ?? env.EMAILIT_FROM_EMAIL ?? null,
    fromName: row.emailit_from_name ?? env.EMAILIT_FROM_NAME,
    apiBaseUrl: row.emailit_api_base_url ?? env.EMAILIT_API_BASE_URL,
  };
}

export interface ResolvedAI {
  provider: 'anthropic' | 'openai_compatible' | 'ollama';
  apiKey: string | null;
  model: string | null;
  baseUrl: string | null;
}

export async function getResolvedAI(): Promise<ResolvedAI> {
  const row = await loadRow();
  const apiKey = row.ai_api_key_encrypted
    ? decryptSecret(row.ai_api_key_encrypted)
    : (env.AI_API_KEY ?? null);
  return {
    provider: row.ai_provider ?? env.AI_PROVIDER_DEFAULT,
    apiKey,
    model: row.ai_model ?? env.AI_MODEL ?? null,
    baseUrl: row.ai_base_url ?? env.AI_BASE_URL ?? null,
  };
}

export async function getResolvedRetentionDays(): Promise<number> {
  const row = await loadRow();
  if (row.retention_days !== null) return row.retention_days;
  const envValue = Number(process.env.RETENTION_DAYS);
  return Number.isFinite(envValue) && envValue > 0 ? envValue : 14;
}

export async function getResolvedLogLevel(): Promise<string> {
  const row = await loadRow();
  return row.log_level ?? env.LOG_LEVEL;
}

// ---------- admin read/write ----------

/** Full read for the SuperAdmin settings UI. Never returns plaintext. */
export async function getApplianceSettingsForAdmin(): Promise<ApplianceSettings> {
  const row = await loadRow();

  const emailitApiKey = pick(
    row.emailit_api_key_encrypted ? 'stored' : null,
    env.EMAILIT_API_KEY ? 'env' : null,
  );
  const emailitFromEmail = pick(row.emailit_from_email, env.EMAILIT_FROM_EMAIL ?? null);
  const emailitFromName = pick(row.emailit_from_name, env.EMAILIT_FROM_NAME);
  const emailitApiBase = pick(row.emailit_api_base_url, env.EMAILIT_API_BASE_URL);

  const aiProvider = pick(row.ai_provider, env.AI_PROVIDER_DEFAULT);
  const aiApiKey = pick(row.ai_api_key_encrypted ? 'stored' : null, env.AI_API_KEY ? 'env' : null);
  const aiModel = pick(row.ai_model, env.AI_MODEL ?? null);
  const aiBaseUrl = pick(row.ai_base_url, env.AI_BASE_URL ?? null);

  const retentionEnv = Number(process.env.RETENTION_DAYS);
  const retentionResolved = pick(
    row.retention_days,
    Number.isFinite(retentionEnv) && retentionEnv > 0 ? retentionEnv : null,
  );

  const logLevel = pick(row.log_level, env.LOG_LEVEL);

  return {
    emailit: {
      apiKeyHasSecret: emailitApiKey.value !== null,
      apiKeySource: emailitApiKey.source,
      fromEmail: emailitFromEmail.value,
      fromEmailSource: emailitFromEmail.source,
      fromName: emailitFromName.value,
      fromNameSource: emailitFromName.source,
      apiBaseUrl: emailitApiBase.value,
      apiBaseUrlSource: emailitApiBase.source,
    },
    sms: {
      provider: row.sms_provider,
      twilio: {
        accountSid: row.twilio_account_sid,
        authTokenHasSecret: !!row.twilio_auth_token_encrypted,
        fromNumber: row.twilio_from_number,
      },
      textlinksms: {
        apiKeyHasSecret: !!row.textlinksms_api_key_encrypted,
        fromNumber: row.textlinksms_from_number,
        baseUrl: row.textlinksms_base_url,
      },
    },
    ai: {
      provider: (aiProvider.value ?? 'anthropic') as ResolvedAI['provider'],
      providerSource: aiProvider.source,
      apiKeyHasSecret: aiApiKey.value !== null,
      apiKeySource: aiApiKey.source,
      model: aiModel.value,
      modelSource: aiModel.source,
      baseUrl: aiBaseUrl.value,
      baseUrlSource: aiBaseUrl.source,
    },
    retentionDays: retentionResolved.value ?? 14,
    retentionDaysSource: retentionResolved.source,
    logLevel: (logLevel.value ?? 'info') as ApplianceSettings['logLevel'],
    logLevelSource: logLevel.source,
  };
}

/**
 * Patch semantics for every field: undefined = no change, null = clear
 * (fall back to env), string/number/provider = set.
 *
 * Secret fields (emailit.apiKey, ai.apiKey) go through encryptSecret
 * before hitting the DB; only the encrypted envelope is stored.
 */
export async function updateApplianceSettings(
  patch: UpdateApplianceSettingsRequest,
): Promise<ApplianceSettings> {
  const updates: Partial<ApplianceSettingsRow> = {};

  if (patch.emailit) {
    const e = patch.emailit;
    if (e.apiKey !== undefined) {
      updates.emailit_api_key_encrypted = e.apiKey === null ? null : encryptSecret(e.apiKey);
    }
    if (e.fromEmail !== undefined) updates.emailit_from_email = e.fromEmail;
    if (e.fromName !== undefined) updates.emailit_from_name = e.fromName;
    if (e.apiBaseUrl !== undefined) updates.emailit_api_base_url = e.apiBaseUrl;
  }
  if (patch.ai) {
    const a = patch.ai;
    if (a.provider !== undefined) updates.ai_provider = a.provider;
    if (a.apiKey !== undefined) {
      updates.ai_api_key_encrypted = a.apiKey === null ? null : encryptSecret(a.apiKey);
    }
    if (a.model !== undefined) updates.ai_model = a.model;
    if (a.baseUrl !== undefined) updates.ai_base_url = a.baseUrl;
  }
  if (patch.sms) {
    const s = patch.sms;
    if (s.provider !== undefined) updates.sms_provider = s.provider;
    if (s.twilio) {
      if (s.twilio.accountSid !== undefined) updates.twilio_account_sid = s.twilio.accountSid;
      if (s.twilio.authToken !== undefined) {
        updates.twilio_auth_token_encrypted =
          s.twilio.authToken === null ? null : encryptSecret(s.twilio.authToken);
      }
      if (s.twilio.fromNumber !== undefined) updates.twilio_from_number = s.twilio.fromNumber;
    }
    if (s.textlinksms) {
      if (s.textlinksms.apiKey !== undefined) {
        updates.textlinksms_api_key_encrypted =
          s.textlinksms.apiKey === null ? null : encryptSecret(s.textlinksms.apiKey);
      }
      if (s.textlinksms.fromNumber !== undefined)
        updates.textlinksms_from_number = s.textlinksms.fromNumber;
      if (s.textlinksms.baseUrl !== undefined) updates.textlinksms_base_url = s.textlinksms.baseUrl;
    }
  }
  if (patch.retentionDays !== undefined) updates.retention_days = patch.retentionDays;
  if (patch.logLevel !== undefined) updates.log_level = patch.logLevel;

  if (Object.keys(updates).length > 0) {
    await db('appliance_settings')
      .where({ id: ROW_ID })
      .update({ ...updates, updated_at: db.fn.now() });
  }

  // Apply runtime-hot changes (just log level for now) before the caller
  // reads the fresh state back.
  if (patch.logLevel !== undefined) {
    const resolved = await getResolvedLogLevel();
    setLogLevel(resolved);
  }

  return getApplianceSettingsForAdmin();
}
