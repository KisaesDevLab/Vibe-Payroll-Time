// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { AUTH_RATE_LIMIT_PER_MINUTE } from '@vibept/shared';
import rateLimit from 'express-rate-limit';

/**
 * IP-based limiter for /auth/* endpoints. Shared across login/refresh/logout
 * — 10 requests / minute is generous enough for real users while bounding
 * bcrypt CPU cost under a credential-stuffing attack.
 */
export const authRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: AUTH_RATE_LIMIT_PER_MINUTE,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'rate_limited',
      message: 'Too many authentication attempts. Please retry shortly.',
    },
  },
});
