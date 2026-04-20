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
