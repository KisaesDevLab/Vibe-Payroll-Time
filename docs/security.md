# Security

This is an _operator-facing_ security reference. For our internal review
checklist before new releases, see `docs/security-review.md`.

## Data at rest

- **PostgreSQL** — runs inside the Docker stack on an internal network, never
  exposed to the host or the public internet. Backed by a host volume
  (`pgdata`) — encrypt the host disk.
- **Secrets** — Twilio auth token, EmailIt API key, AI API key, and license
  JWT are stored encrypted with **AES-256-GCM** keyed on
  `SECRETS_ENCRYPTION_KEY` (32-byte hex). Losing this key renders the
  encrypted secrets unrecoverable — include it in your backup procedure.
- **Passwords** — bcrypt cost 12.
- **PINs** — bcrypt cost 10. An HMAC-SHA256 fingerprint (HKDF-keyed) makes
  kiosk lookup O(1) without widening the bcrypt surface.
- **Refresh tokens** — SHA-256 hash in DB; rotate atomically on use.

## Data in transit

- **TLS terminates at Caddy** (auto-Lets-Encrypt for the `public` profile) or
  at the tunnel sidecar (`cloudflared` / `tailscale`).
- Internal container-to-container traffic is plaintext on the private bridge
  network — never crosses the host.
- **HSTS, X-Frame-Options, X-Content-Type-Options** set by `helmet` on every
  response.

## Auth surfaces

| Path                                | Token                                        | Scope                       |
| ----------------------------------- | -------------------------------------------- | --------------------------- |
| Admin + supervisor + employee login | JWT HS256 (15m access + 30d refresh)         | `roleGlobal`, `memberships` |
| Kiosk                               | Device token (opaque, stored SHA-256-hashed) | pair ⇄ company              |
| Kiosk employee session              | JWT HS256 (5m)                               | lookup-and-punch only       |

Access tokens never carry the company membership list directly — every
sensitive endpoint re-reads the membership from `company_memberships` on
every request so revoking a role takes effect immediately.

## Password recovery and magic-link login

- **Magic links**: a single-use 256-bit token with a SHA-256 hash stored in
  `magic_links`. TTL 15 minutes. Rate-limited to 3 requests per identifier
  per hour. `POST /auth/magic/request` is a silent no-op for unknown
  identifiers — the response never reveals whether an account exists.
- **Magic-link origin** is the client-supplied `window.location.origin`
  validated against the `CORS_ORIGIN` env whitelist. An attacker can't
  supply `origin=https://evil.example` and redirect a real user's link —
  the server falls back to its own host if the supplied origin isn't on
  the whitelist.
- **Magic-link access tokens** carry `authMethod: 'magic_link'`.
  `POST /auth/set-password` accepts a new password without requiring the
  current one ONLY for those sessions — a stolen password-session access
  token cannot use this endpoint. After the 15-min access-token TTL, a
  refresh rotates the session back to `authMethod: 'password'` and the
  set-password window closes.
- **Change password with current**: `POST /auth/change-password` always
  requires the current password. Revokes all refresh tokens for the user
  on success so other sessions re-authenticate.
- **User-level phone** (`users.phone`): separate from `employees.phone`.
  SMS-verified via a 6-digit bcrypt-hashed code through the
  appliance-level SMS provider (NOT a per-company provider). Powers
  SuperAdmin magic-link-by-SMS. Changing the number clears prior
  verification state atomically.
- **Setup gate hardening**: `POST /setup/initial` refuses if EITHER
  `installation_id` is already stamped OR any `super_admin` row has ever
  existed (including disabled ones). Disabling the only SuperAdmin does
  NOT reopen the wizard.

## Notification log

- `notifications_log` captures every outbound email/SMS with recipient,
  channel, type, status, and a trimmed payload for diagnostics.
- **Sensitive types are redacted at write time**: `magic_link`,
  `password_reset`, and `phone_verification` rows store
  `payload: { redacted: true }` instead of the rendered body. A
  CompanyAdmin with log access cannot copy another user's magic link
  out of the log and sign in as them.
- Template HTML escapes interpolated values (`firstName`, `reason`,
  `reviewNote`, custom `appName`) so a correction-note that contains
  HTML tags doesn't execute in an admin's inbox preview.

## Licensing

- RS256 JWTs issued by the **kisaes-license-portal**.
- Verified against a public key configured via `LICENSE_PUBKEY_PEM`; no key is
  bundled in the image.
- License state is stored per-company; SuperAdmin can mark a company as
  `internal` to exempt it.
- Enforcement is gated by `LICENSING_ENFORCED=true`. With enforcement off,
  every check short-circuits to pass — useful pre-launch.
- Expired licenses block new punches + edits but **never** read or export
  (data always accessible, staff never locked out).

## AI data flow

When AI is enabled for a company:

- **NL timesheet corrections** send the user's prompt + a sanitized snapshot
  of the relevant entries to the provider. The provider's tool-call output is
  _not_ executed — it's rendered as a diff preview; the human clicks **Apply**
  to funnel the change through the normal punch chokepoint with
  `edit_reason = "AI: <original prompt>"`.
- **Support chat** sends the prompt + a ~80k-char RAG slice from the bundled
  user docs. The support-chat tool has **zero write capability** — it cannot
  call any tool, only answer in text.
- All prompts + completions are logged to `ai_correction_usage` (for NL
  corrections) for rate-limiting and operator review.
- Setting `ai_enabled = false` on a company skips every LLM call.

No customer PII (home addresses, SSNs, bank info) is ever in the database, so
nothing of that nature ever reaches the provider.

## Audit trail

- Every edit to a `time_entry` writes a `time_entry_audit` row with actor,
  timestamp, field, old/new values, and edit reason.
- Every auth event (success + failure + logout + refresh rotate) writes an
  `auth_events` row.
- Both tables are append-only — no user-facing edit path.

## Backups

Four levels, detailed in `docs/restore.md`:

1. **WAL archiving** (continuous, for PITR)
2. **Nightly pg_dump** (on-disk, 14-day retention)
3. **Weekly S3 copy** (off-site, customer-configured)
4. **On-demand export-everything ZIP** (logical, per-company, SuperAdmin)

## QR badge authentication

Badges are an auth feature, not a surveillance feature — no GPS, no photo, no
biometric, no location tracking.

### Token format

`vpt1.{companyId}.{employeeId}.{badgeVersion}.{nonce}.{hmac}` where:

- The HMAC is SHA-256 over the preceding dotted fields, truncated to 128 bits
  (base64url). Signed with a 32-byte appliance-wide key derived from
  `SECRETS_ENCRYPTION_KEY` via HKDF, overridable with `BADGE_SIGNING_SECRET`.
- `nonce` is 8 random bytes (64 bits) so two payloads for the same
  `(company, employee, version)` triple hash differently.
- `badge_version` starts at 1 on first issue and increments monotonically. The
  server stores only `sha256(payload)` in `employees.badge_token_hash`; the
  plaintext payload exists exactly once (in the `issueBadge` response) and
  then only on the printed badge.

### Verification order

`verifyBadge` on the kiosk checks, in order:

1. Per-kiosk rate limit (20 scans/min; 21st trips a 60-sec cooldown).
2. HMAC validity.
3. Payload's `companyId` matches the scanning kiosk's company.
4. Employee row exists and is active.
5. Employee's badge isn't revoked.
6. Payload's `badge_version` matches the employee's current version.
7. Stored `badge_token_hash` matches `sha256(payload)`.

Every outcome — success OR failure — writes a `badge_events` row with the
reason. A spike of `scan_failure(reason='version_mismatch')` means someone is
presenting an old laminated badge after a reissue; a spike of `bad_hmac`
means someone is scanning random QR codes.

### Key rotation

Rotating `BADGE_SIGNING_SECRET` (or its HKDF source) invalidates every badge
in the appliance. Recovery is bulk-reissue: **Employees → select all →
Issue badges for N**. There is no less-disruptive rotation; the security
argument is that this is a five-minute problem to fix, not a production
emergency.

### What an attacker with a photo of a badge can do

**Punch in as that employee at a kiosk in the same company** — until the
badge is revoked or reissued. Nothing more. Badges cannot:

- Be scanned from a personal device (only paired kiosks).
- Reach admin endpoints (kiosk JWT scope is punch-only).
- Be brute-forced (21 bad scans = 60-sec lockout; the HMAC key space is
  128 bits).
- Be reused across companies (companyId is HMAC-bound; cross-company scans
  are rejected server-side before the employee lookup).
- Survive a revoke or reissue — the next scan fails loudly and logs a
  `scan_failure` audit row.

The risk model for a stolen badge is the same as a stolen 4-6 digit PIN,
except the PIN has ~1M possibilities and the badge is a 128-bit HMAC key
scoped to one employee.

## Reporting a vulnerability

Email **security@kisaes.com** with "Vibe Payroll Time" in the subject. We
commit to acknowledging within two business days and to a coordinated-
disclosure timeline thereafter.

## Manual entries preserve punches

When a manager posts a manual override, the punch rows it replaces are
marked `superseded_by_entry_id` in the DB — they are never deleted.
Delete the manual entry and the punches return to the active view.

This matters for wage-and-hour defensibility. A DOL investigator
asking "show me every punch that was edited" can see both the original
event (the punch) and the override (the manual entry with its reason
and actor) by reading `time_entry_audit`, which records a
`manual_override` action per superseded punch plus `manual_create` /
`manual_update` / `manual_delete` / `manual_revert` events for the
lifecycle of the manual entry.

Authorization for manual entries is in three layers: the `canManualEdit`
pure function (unit-tested across the full role × mode × approval
matrix), the service layer that rechecks the actor and the approval
state under a transaction, and the DB partial-unique index that
prevents a second active manual entry on the same (employee, day, job).
