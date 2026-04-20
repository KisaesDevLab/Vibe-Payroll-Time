# Security Review Checklist

Run through this before tagging a release. Each item either passes, has a
documented waiver, or blocks the release.

## Auth + sessions

- [ ] All authenticated routes reject requests with no `Authorization` header
- [ ] Access tokens expire in ≤ 15 minutes; tested by freezing clock
- [ ] Refresh tokens rotate atomically on use (no double-use accepted)
- [ ] Kiosk employee session tokens expire in ≤ 5 minutes
- [ ] PIN lookup is constant-time w.r.t. which employee matched (no timing
      side channel through bcrypt cost × candidate count)
- [ ] Kiosk device tokens are stored SHA-256-hashed, never in plaintext
- [ ] Revoking a company membership takes effect on the next request (claims
      are re-read from DB, not trusted from JWT)

## Input validation

- [ ] Every HTTP route parses its body through a Zod schema
- [ ] Every path param is parsed as an integer before use as a key
- [ ] Knex queries use parameters, not string interpolation, for every user-
      supplied value (spot-check with `grep -rn "knex.raw\|db.raw"`)
- [ ] Zod error paths don't leak stack traces to clients

## Tenant isolation

- [ ] Every service method that touches a tenant-scoped table takes
      `companyId` as an explicit argument
- [ ] No service method infers `companyId` from `req` deep in the call stack
- [ ] Integration tests cover a cross-tenant read attempt and assert it 403s
- [ ] Grep for raw `db(<table>).where(...)` without a `company_id` clause and
      confirm each hit is either (a) a `_settings` row by PK, (b) a
      superadmin-only admin path, or (c) documented

## Secrets

- [ ] `SECRETS_ENCRYPTION_KEY` is read from env, never hard-coded
- [ ] `JWT_SECRET` is ≥ 32 chars (enforced by Zod at boot)
- [ ] Encrypted columns use AES-256-GCM with v1 envelope (`v1.iv.tag.ct`)
- [ ] Decryption rejects old envelopes we have retired

## AI

- [ ] Support-chat tool has zero write capability; verified by running the
      tool against a prompt asking it to edit a time entry
- [ ] NL-correction tool output is rendered as diff preview; **no apply
      without explicit click**
- [ ] Every applied correction routes through the punch chokepoint with a
      non-empty `edit_reason`
- [ ] `ai_enabled = false` on a company skips every provider call
- [ ] Prompts + completions are truncated to the documented 4k cap before
      being logged

## Licensing

- [ ] `LICENSING_ENFORCED=false` makes every enforcement call a no-op
- [ ] With enforcement on, expired licenses block mutation endpoints only —
      GET and export endpoints still serve
- [ ] Internal-flagged companies bypass enforcement entirely
- [ ] License JWTs are verified with RS256 against `LICENSE_PUBKEY_PEM`;
      tokens without a pub key configured fail closed in prod

## Backups + restore

- [ ] Level-2 backup script tested on a fresh host against a real dump
- [ ] Restore drill completed in ≤ 15 minutes for a 500-employee tenant
- [ ] Level-4 export ZIP opens in Finder/Explorer and contains a manifest
- [ ] Level-4 export redacts: `pin_hash`, `pin_fingerprint`, `password_hash`,
      encrypted API keys, kiosk `token_hash`

## HTTP

- [ ] helmet + CORS are enabled in `createApp`
- [ ] `trust proxy: 1` is set so Caddy's `X-Forwarded-For` is honored
- [ ] Rate-limiter applies to `/auth/login`, `/auth/refresh`, kiosk PIN,
      phone-verification request
- [ ] Responses use the `{ data, meta? }` / `{ error }` envelope consistently
- [ ] 5xx errors don't leak stack traces to clients (pino logs the full
      stack; the client sees a generic `internal_error`)

## Supply chain

- [ ] `npm audit` clean, or every finding has a documented justification
- [ ] No `--ignore-scripts` bypasses in any Dockerfile
- [ ] Git repo has no committed `.env`, `dev-keys/`, or licence JWTs
      (`git log --all -p | rg -i "BEGIN RSA"`)
- [ ] Images are rebuilt from a pinned Node + Postgres base; no `latest`

## Release

- [ ] `CHANGELOG.md` has an entry for this version
- [ ] `CLAUDE.md` reflects any architectural changes
- [ ] Tag signed with a valid GPG key (preferred) or at minimum annotated
- [ ] Appliance install script pulls the tagged image, not `latest`

Sign-off: _reviewer name_ &nbsp;&nbsp;&nbsp; Date: _YYYY-MM-DD_
