// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
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

// Phase 14 env-var renames for cross-app parity with sibling Vibe apps
// (Vibe-MyBooks, Vibe-Connect). Old names continue to work; if the
// canonical name is unset we copy the legacy value forward and log a
// single deprecation line. New name wins when both are present.
function resolveDeprecatedAlias(canonical: string, legacy: string) {
  const canonicalValue = process.env[canonical];
  const legacyValue = process.env[legacy];
  const canonicalSet =
    canonicalValue !== undefined && canonicalValue !== null && canonicalValue !== '';
  const legacySet = legacyValue !== undefined && legacyValue !== null && legacyValue !== '';
  if (!canonicalSet && legacySet) {
    process.env[canonical] = legacyValue;
    // eslint-disable-next-line no-console
    console.warn(
      `[deprecated] ${legacy} is deprecated; rename to ${canonical}. ` +
        `The old name still works for now and will be removed in a future release.`,
    );
  } else if (canonicalSet && legacySet && canonicalValue !== legacyValue) {
    // eslint-disable-next-line no-console
    console.warn(
      `[deprecated] both ${canonical} and ${legacy} are set with different values; ${canonical} wins.`,
    );
  }
}

resolveDeprecatedAlias('ALLOWED_ORIGIN', 'CORS_ORIGIN');
resolveDeprecatedAlias('MIGRATIONS_AUTO', 'MIGRATE_ON_BOOT');
// LLM_* are the sibling-Vibe-app canonical names. AI_* lives on as a
// legacy alias because it pre-dates the rename and is heavily
// documented in CLAUDE.md and .env.example.
resolveDeprecatedAlias('LLM_API_KEY', 'AI_API_KEY');
resolveDeprecatedAlias('LLM_MODEL', 'AI_MODEL');
resolveDeprecatedAlias('LLM_ENDPOINT', 'AI_BASE_URL');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  APPLIANCE_ID: z.string().default('local-dev'),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  BACKEND_HOST: z.string().default('0.0.0.0'),

  /** Comma-separated list of allowed CORS origins. Each entry may be
   *  either a literal origin (`https://example.com`) or a regex
   *  delimited with slashes (`/^https:\/\/.*\.tailnet\.ts\.net$/`).
   *  Phase 14 rename: legacy `CORS_ORIGIN` is read as a fallback. */
  ALLOWED_ORIGIN: z.string().default('http://localhost:5180'),

  /** Canonical public origin embedded in outbound URLs (magic-link
   *  emails, payroll-export download links, password-reset links).
   *  Optional — when unset, the first entry of ALLOWED_ORIGIN is used,
   *  preserving pre-Phase-14 behavior for standalone customers who
   *  haven't set this yet. */
  PUBLIC_URL: optionalEnvString(),

  /** Redis connection string for BullMQ. Required when MIGRATIONS_AUTO
   *  is true and the four core background jobs (auto-clockout,
   *  missed-punch, license-heartbeat, retention-sweep) need to run.
   *  Standalone install.sh provisions a redis:7-alpine container by
   *  default. Falls back to localhost:6379 in dev. */
  REDIS_URL: z.string().default('redis://localhost:6379'),

  /** Per-worker concurrency for BullMQ consumers. Two is plenty for
   *  the four cron-style jobs Payroll-Time runs; bump if customer
   *  workload grows. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),

  /** Master switch for background-job runtime. When false, the
   *  scheduler and workers don't start; Redis is never contacted. Used
   *  by the test suite (no Redis fixture) and by dev environments
   *  that haven't provisioned Redis yet. The four `run*()` business
   *  functions remain directly callable. */
  WORKERS_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes'),

  /** Which background-job role this process plays:
   *   - `all`       (default for standalone): API container schedules
   *                 + consumes jobs in-process. Single-container.
   *   - `scheduler`: API container only enqueues; appliance overlay
   *                 sets this so it doesn't compete with the
   *                 dedicated worker container.
   *   - `worker`:    Worker container only consumes; entrypoint is
   *                 dist/worker.js. */
  WORKER_ROLE: z.enum(['all', 'scheduler', 'worker']).default('all'),

  /** Multi-tenancy mode.
   *   - `multi`  (default for standalone): one appliance hosts many
   *              companies. The "create new firm" flow is visible;
   *              users can switch between companies.
   *   - `single` (appliance overlay): one company per appliance. The
   *              create-firm flow is hidden; the API refuses to start
   *              if the database holds more than one company. The
   *              setup wizard auto-fills the firm name from
   *              FIRM_NAME on first boot. */
  TENANT_MODE: z.enum(['single', 'multi']).default('multi'),

  /** Display name to seed the first company with when the appliance
   *  bootstraps in `single` tenant mode. Operators set this in their
   *  appliance overlay so the company exists with the customer's name
   *  before the first SuperAdmin signs up. Ignored when `multi`. */
  FIRM_NAME: optionalEnvString(),

  /** Cookie path + secure flag — accepted but unused while auth is bearer-token
   *  only. Plumbed for the multi-app deployment overlay (`/payroll` path,
   *  Secure=true behind shared HTTPS ingress) so a future cookie middleware
   *  picks up the right scope without another env-schema change.
   *
   *  COOKIE_SECURE accepts three values:
   *   - `true`  always set the Secure flag (single-domain HTTPS)
   *   - `false` never set the Secure flag (dev / standalone HTTP)
   *   - `auto`  set Secure when the request is over HTTPS (the
   *             appliance default — the parent Caddy terminates TLS
   *             but the API container sees HTTP-from-proxy, and the
   *             :5192 emergency port is plain HTTP) */
  COOKIE_PATH: z.string().default('/'),
  COOKIE_SECURE: z
    .enum(['true', 'false', 'auto'])
    .default('false')
    .transform((v): true | false | 'auto' => (v === 'auto' ? 'auto' : v === 'true')),

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

  /** Run pending Knex migrations during server boot. Default true
   *  preserves the historical standalone behavior. The appliance
   *  overlay sets this to "false" because the parent compose runs a
   *  one-shot migrate sidecar before bringing the API up. Phase 14
   *  rename: legacy `MIGRATE_ON_BOOT` is read as a fallback. */
  MIGRATIONS_AUTO: z
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

  // ---------- SMS (appliance-wide fallback) ----------
  /** Appliance-wide SMS provider, used when the appliance_settings row
   *  hasn't picked one. `textlink` is accepted as an alias for the
   *  canonical `textlinksms`. `none` disables SMS for any flow that
   *  doesn't have an explicit per-company provider. Any other value
   *  fails zod parse — we'd rather refuse to boot than silently drop
   *  notifications because of a typo. */
  SMS_PROVIDER: z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const lc = v.trim().toLowerCase();
      if (lc === '' || lc === 'none') return undefined;
      if (lc === 'textlink') return 'textlinksms';
      return lc;
    },
    z.enum(['twilio', 'textlinksms']).optional(),
  ),

  // ---------- AI / LLM (appliance-wide fallback) ----------
  // LLM_* are the canonical names (Phase 14 — match sibling Vibe
  // apps); AI_* are read as fallbacks via resolveDeprecatedAlias
  // above so the env-schema fields here are the same string slots,
  // just renamed. The DB-backed per-company AI config wins over
  // anything here when set.
  AI_PROVIDER_DEFAULT: z.enum(['anthropic', 'openai_compatible', 'ollama']).default('anthropic'),
  LLM_API_KEY: optionalEnvString(),
  LLM_MODEL: optionalEnvString(),
  LLM_ENDPOINT: optionalEnvString(),

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
