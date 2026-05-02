// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.

// Origin-resolution helpers used wherever an outbound URL is built —
// magic-link emails, payroll-export download links, password resets.
// Centralized so the precedence rules stay consistent everywhere:
//
//   1. PUBLIC_URL when set (operator's canonical public origin)
//   2. Client-supplied origin if it matches an ALLOWED_ORIGIN literal
//   3. The request's own host header (last-resort fallback)
//
// Phase 14: introduced alongside the ALLOWED_ORIGIN rename and the
// shift to one canonical PUBLIC_URL for outbound-link generation.

const trimSlashes = (s: string) => s.replace(/\/+$/, '');

export type AllowedOriginEntry =
  | { kind: 'literal'; value: string }
  | { kind: 'regex'; value: RegExp };

/**
 * Parse a comma-separated ALLOWED_ORIGIN string. Each entry is either a
 * literal origin (`https://example.com`) or a regex delimited with
 * forward slashes (`/^https:\/\/.*\.tailnet\.ts\.net$/`). Trailing
 * slashes on literals are stripped to match how the cors middleware
 * compares origins.
 */
export function parseAllowedOriginEntries(input: string): AllowedOriginEntry[] {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((raw) => {
      if (raw.startsWith('/') && raw.lastIndexOf('/') > 0) {
        const lastSlash = raw.lastIndexOf('/');
        const pattern = raw.slice(1, lastSlash);
        const flags = raw.slice(lastSlash + 1);
        try {
          return { kind: 'regex' as const, value: new RegExp(pattern, flags) };
        } catch (err) {
          // Fail loud at parse time — falling back to a literal would
          // silently produce an origin nobody can match (e.g.
          // `/[unclosed/` ≠ any real Origin header). The operator
          // sees this only at boot via the env-validation throw
          // surfaced in env.ts; better than a runtime CORS reject.
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`Invalid ALLOWED_ORIGIN regex entry "${raw}": ${message}`);
        }
      }
      return { kind: 'literal' as const, value: trimSlashes(raw) };
    });
}

/**
 * Build the origin callback the cors() middleware expects. Accepts an
 * origin if any literal matches exactly or any regex tests true.
 * Same-origin / non-CORS requests (no Origin header) are always allowed.
 */
export function parseAllowedOrigins(input: string) {
  const entries = parseAllowedOriginEntries(input);
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true);
    const candidate = trimSlashes(origin);
    const allowed = entries.some((e) =>
      e.kind === 'literal' ? e.value === candidate : e.value.test(candidate),
    );
    cb(null, allowed);
  };
}

/**
 * Test whether an origin string is on the ALLOWED_ORIGIN list. Pure
 * function, no side effects — used by magic-link / export URL builders
 * to validate a client-supplied origin before embedding it in an
 * outbound link.
 */
export function isOriginAllowed(origin: string, allowedOrigin: string): boolean {
  const entries = parseAllowedOriginEntries(allowedOrigin);
  const candidate = trimSlashes(origin);
  return entries.some((e) =>
    e.kind === 'literal' ? e.value === candidate : e.value.test(candidate),
  );
}

/**
 * Pick the right origin to embed in an outbound URL. PUBLIC_URL wins
 * when set (the operator told us "this is my canonical public origin
 * — use it for emails"). Otherwise prefer the client-supplied origin
 * if it's on the ALLOWED_ORIGIN list; failing that, fall back to the
 * request's own host header.
 */
export function resolvePublicOrigin(opts: {
  publicUrl?: string;
  allowedOrigin: string;
  clientOrigin?: string;
  requestOrigin: string;
}): string {
  const { publicUrl, allowedOrigin, clientOrigin, requestOrigin } = opts;
  if (publicUrl) return trimSlashes(publicUrl);
  if (clientOrigin) {
    const trimmed = trimSlashes(clientOrigin);
    if (isOriginAllowed(trimmed, allowedOrigin)) return trimmed;
  }
  return trimSlashes(requestOrigin);
}
