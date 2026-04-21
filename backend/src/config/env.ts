import 'dotenv-flow/config';
import { z } from 'zod';

/**
 * Optional string that treats empty / whitespace-only input as unset.
 * Without this, `.env.example` ships many keys as `FOO=` and the literal
 * empty string survives to runtime, defeating `??` fallbacks and (for
 * `.email()` fields) failing zod validation at boot.
 */
const optionalEnvString = () =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const trimmed = v.trim();
      return trimmed === '' ? undefined : trimmed;
    });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  APPLIANCE_ID: z.string().default('local-dev'),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  BACKEND_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: optionalEnvString(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().default('vibept'),
  POSTGRES_PASSWORD: z.string().default('vibept_dev'),
  POSTGRES_DB: z.string().default('vibept'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_ENCRYPTION_KEY must be 32 bytes hex (64 chars)'),

  /** Appliance-wide HMAC key for signing QR badge payloads. Rotating this
   *  invalidates every existing badge; recovery path is bulk-reissue via
   *  the admin UI. Optional in dev — derived from SECRETS_ENCRYPTION_KEY
   *  via HKDF when unset, same pattern as the PIN fingerprint key. */
  BADGE_SIGNING_SECRET: optionalEnvString(),

  MIGRATE_ON_BOOT: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  /** Run the demo-company seed (Acme Plumbing, six employees, ~14 days of
   *  entries) after migrations on boot. Idempotent — the seed deletes
   *  and recreates the demo company on each run, so flipping this on
   *  in a live appliance will wipe any local demo edits the operator
   *  made. Safe on a fresh appliance or a demo VM. Default off. */
  SEED_DEMO_ON_BOOT: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /** Where payroll-export CSV files are written. Relative paths resolve
   *  against the backend's cwd. The directory is created lazily. */
  EXPORTS_DIR: z.string().default('./exports'),

  // ---------- EmailIt (appliance-wide fallback) ----------
  /** If set, used when a company has not configured its own EmailIt
   *  API key. Leave blank to make email a per-company opt-in. */
  EMAILIT_API_KEY: optionalEnvString(),
  EMAILIT_FROM_EMAIL: optionalEnvString().pipe(z.string().email().optional()),
  EMAILIT_FROM_NAME: z.string().default('Vibe Payroll Time'),
  /** Override if EmailIt ever publishes a different base URL. */
  EMAILIT_API_BASE_URL: z.string().default('https://api.emailit.com/v2'),

  /** Disables outbound email + SMS entirely (useful for dev + test).
   *  Log rows are still written with a 'disabled' status so the admin
   *  UI reflects that the send was skipped. */
  NOTIFICATIONS_DISABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  // ---------- AI (appliance-wide fallback) ----------
  AI_PROVIDER_DEFAULT: z.enum(['anthropic', 'openai_compatible', 'ollama']).default('anthropic'),
  AI_API_KEY: optionalEnvString(),
  AI_MODEL: optionalEnvString(),
  AI_BASE_URL: optionalEnvString(),

  // ---------- Licensing ----------
  /** Master switch. When false (the default), the license middleware
   *  short-circuits every check to pass — the appliance runs fully
   *  unlicensed. Flip to true once the customer goes live and the
   *  license portal is reachable. */
  LICENSING_ENFORCED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  /** Override the bundled kisaes-license-portal RSA public key (PEM).
   *  Leave blank in dev; set in prod via the appliance installer. */
  LICENSE_PUBKEY_PEM: optionalEnvString(),

  /** URL of the license portal's heartbeat endpoint. When unset the
   *  daily heartbeat cron is a no-op, useful for air-gapped previews. */
  LICENSE_PORTAL_HEARTBEAT_URL: optionalEnvString(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Surface the first issue clearly; the app cannot boot without valid config.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`[vibept] invalid environment configuration:\n${issues}`);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
export type Env = typeof env;

export const isProd = env.NODE_ENV === 'production';
export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
