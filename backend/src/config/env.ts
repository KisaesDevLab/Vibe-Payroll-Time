import 'dotenv-flow/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),

  APPLIANCE_ID: z.string().default('local-dev'),

  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  BACKEND_HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().optional(),
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().default('vibept'),
  POSTGRES_PASSWORD: z.string().default('vibept_dev'),
  POSTGRES_DB: z.string().default('vibept'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'SECRETS_ENCRYPTION_KEY must be 32 bytes hex (64 chars)'),

  MIGRATE_ON_BOOT: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
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
