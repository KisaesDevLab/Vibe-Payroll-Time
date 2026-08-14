// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import type { Request } from 'express';
import { env } from '../config/env.js';
import { resolvePublicOrigin } from '../config/public-url.js';

/**
 * Resolve the origin to embed in an outbound link for this request.
 *
 * Wraps `resolvePublicOrigin` with the Express-specific bits (protocol,
 * Host header, env lookup) so the four routes that mint emailed URLs —
 * magic link, password reset, and the two admin-initiated send-link
 * endpoints — can't drift apart in how they pick a host.
 *
 * `clientOrigin` is `window.location.origin` as reported by the caller.
 * It's advisory: an attacker can't redirect a link by supplying a bogus
 * value because `resolvePublicOrigin` checks it against the
 * ALLOWED_ORIGIN whitelist before trusting it.
 */
export function originForRequest(req: Request, clientOrigin?: string): string {
  return resolvePublicOrigin({
    publicUrl: env.PUBLIC_URL,
    allowedOrigin: env.ALLOWED_ORIGIN,
    ...(clientOrigin !== undefined ? { clientOrigin } : {}),
    requestOrigin: `${req.protocol}://${req.get('host') ?? ''}`,
  });
}
