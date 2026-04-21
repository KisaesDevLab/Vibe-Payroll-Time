import { pino } from 'pino';
import { env, isProd } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
  base: { service: 'vibept-backend', appliance_id: env.APPLIANCE_ID },
  redact: {
    paths: ['req.headers.authorization', 'password', 'passwordHash', 'pinHash'],
    censor: '[REDACTED]',
  },
});

export type Logger = typeof logger;

const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);

/**
 * Change the running logger level without a restart. SuperAdmin-facing
 * settings call this after patching the DB so a `info` → `debug` swap
 * takes effect immediately for the next request.
 */
export function setLogLevel(level: string): void {
  if (!VALID_LEVELS.has(level)) {
    logger.warn({ level }, 'refusing to set invalid log level');
    return;
  }
  if (logger.level !== level) {
    logger.info({ from: logger.level, to: level }, 'log level changed at runtime');
    logger.level = level;
  }
}
