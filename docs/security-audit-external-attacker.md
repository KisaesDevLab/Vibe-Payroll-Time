# Security Audit — External Attacker

| Field        | Value                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| Date         | 2026-04-21                                                                                           |
| Auditor      | Claude Code                                                                                          |
| Threat model | Unauthenticated network attacker reaching the public API surface; compromised-admin escalation paths |
| Methodology  | Code inspection of all routes, services, and host-side IPC scripts; `npm audit`; no live pentest     |

Companion audits:

- `docs/security-audit-employee-isolation.md` — authenticated-employee data access.
- `docs/security-review.md` — operator-facing posture reference.

## TL;DR

| Severity     | Count | Items                                                                                 |
| ------------ | :---: | ------------------------------------------------------------------------------------- |
| **CRITICAL** |   0   | —                                                                                     |
| **HIGH**     |   0   | —                                                                                     |
| **MEDIUM**   |   4   | Tunnel token sed-injection, AI base-URL SSRF, phone-verify rate-limit gap, DoS arrays |
| **LOW**      |   3   | CSP disabled, dev-dep esbuild advisory, JWT_SECRET min length                         |

All MEDIUMs closed; LOWs documented with rationale. Full test suite still green (325/325).

---

## Threat model

An attacker's starting point is:

1. **Unauthenticated, network-reachable** — can hit any endpoint without credentials.
2. **Compromised low-privilege user** — owns a rank-and-file employee session (phished magic link, password stuffed, etc.).
3. **Compromised admin/SuperAdmin** — highest blast radius. Considered because audit events should limit what even a compromised admin can do outside the app's normal blast radius (e.g. no host-level RCE).

Explicit non-goals for this audit:

- Physical access to the appliance (GMKtec NucBox reference hardware). Mitigated by `SECRETS_ENCRYPTION_KEY` encryption-at-rest + operator disk-encryption recommendation.
- Network MITM inside the customer LAN. Mitigated by Caddy auto-TLS or tunnel sidecar TLS.
- Supply-chain attack on npm registry or base Docker image. Mitigated by `npm audit` + license-policy audit + `npm ci` with lock file.

---

## Finding 1 — Cloudflared tunnel token sed-injection → host RCE (MEDIUM, fixed)

**Attack chain:**

1. Attacker compromises a SuperAdmin session (phish, credential stuffing — 10 attempts/min rate limit is the bar).
2. Attacker hits `PATCH /admin/tunnel` with a crafted token value containing `|` / `\n` / `e`-flag sequences.
3. Backend writes the token to `update-control/tunnel-request.json` via `JSON.stringify` (properly escaped).
4. Host systemd path unit fires `tunnel-from-request.sh`, which extracts the token via `sed -nE '…'` and passes it to `upsert_env_var`, which does `sed -i -E "s|^KEY=.*$|KEY=${escaped}|" "$ENV_FILE"`.
5. The `sed-escape` step only handles `/ & \`; the `|` delimiter in the substitution is NOT escaped. A token ending in `|e|` could (depending on GNU sed version) terminate the substitution early and pass flags that include `e` — the execute flag — turning the replacement into a shell command run as root.

This escalates app-admin compromise to host root — a meaningfully wider blast radius than "admin can re-upload a license / reseed a demo company / spam SMS."

**Fix:** `shared/src/schemas/appliance-settings.ts` — tightened `token` to a base64url-ish charset `[A-Za-z0-9+/=_\-.:]`. Cloudflared's actual tokens are base64-encoded JWTs, so the restriction doesn't reject real tokens in the field. The regex blocks every character class that could break out of the sed substitution (`|`, newline, `;`, `$`, backtick, etc.).

```ts
token: z
  .string()
  .min(20)
  .max(4096)
  .regex(/^[A-Za-z0-9+/=_\-.:]+$/, 'token contains characters that are not valid ...')
  .nullable()
  .optional(),
```

Defense-in-depth: the host script's containing directory is `chmod 700`, which limits non-root readers; the request file itself is `chmod 600` and deleted after apply; `.env` is `chmod 600`. Even under a successful escape, the blast radius is "whatever the systemd unit runs as" (root on the host, per the install playbook). Fixing at the Zod layer prevents the attempt from ever reaching the script.

---

## Finding 2 — AI `baseUrl` SSRF primitive (MEDIUM, fixed)

**Attack chain:**

1. Attacker compromises a CompanyAdmin session (single-company scope, not SuperAdmin).
2. Attacker hits `PATCH /companies/:id/ai/settings` with `aiBaseUrl=http://169.254.169.254/latest/meta-data/iam/security-credentials/` and `aiProvider=openai_compatible`.
3. Triggers `/ai/chat` or `/ai/nl-correction/preview` — the backend's `fetch` targets the attacker-chosen URL with a POST body the attacker controls; the response body is returned to the attacker (in chat) or influences tool calls (in NL correction).

On AWS, that URL returns temporary IAM credentials. On-prem, pointing at a localhost-bound admin UI or an intranet service has similar consequences.

**Fix:** `shared/src/schemas/ai.ts` — new `aiBaseUrlSchema` requires `http(s)://` scheme and explicitly rejects the cloud-metadata IPv4 `169.254.*` and IPv6 `fd00:ec2::254` addresses. This is a fast fail-closed for the common cases; hardened deployments should still place the backend behind an egress allowlist for full SSRF containment.

```ts
const aiBaseUrlSchema = z
  .string()
  .max(512)
  .refine((v) => /^https?:\/\//i.test(v), 'aiBaseUrl must be an http(s) URL')
  .refine(
    (v) => !/^https?:\/\/169\.254\./i.test(v),
    'aiBaseUrl cannot target the cloud metadata address 169.254.x.x',
  )
  .refine(
    (v) => !/^https?:\/\/\[?fd00:ec2::254/i.test(v),
    'aiBaseUrl cannot target the cloud metadata address fd00:ec2::254',
  );
```

Note: the schema intentionally does NOT block `localhost` / RFC-1918 ranges — operators legitimately run local Ollama on `http://host.docker.internal:11434` or similar. Operators who want full internal-network containment should enforce at the network layer.

---

## Finding 3 — Phone-verification endpoints lacked rate-limit (MEDIUM, fixed)

**Attack chain:**

- `POST /notifications/phone-verification/request`: each call triggers a TextLinkSMS or Twilio outbound SMS. An attacker with a hijacked employee session could spam this to their own (or victim's) phone, burning the operator's SMS budget.
- `POST /notifications/phone-verification/confirm`: the per-code `MAX_ATTEMPTS=5` counter resets on every new code request. Without an HTTP rate limit, an attacker could request → try 5 codes → request → try 5 → ... until they land on the 6-digit code.

**Fix:** `backend/src/http/routes/notifications.ts` — both endpoints now wrap `authRateLimiter` (the same 10/min/IP limiter shared across `/auth/*` and `/me/phone/verify-*`).

---

## Finding 4 — Unbounded array fields → request-amplification DoS (MEDIUM, fixed)

Several Zod schemas accepted `z.array(...).min(1)` without a `.max(...)`. With the 1MB JSON body limit, an attacker can stuff many thousands of entries into a single request. Each entry gets validated + (for apply/approve paths) triggers DB work.

- `nlCorrectionApplyRequestSchema.toolCalls` — loops `editEntry`/`deleteEntry` per call
- `chatRequestSchema.messages` — loops into LLM prompt assembly
- `approvePeriodRequestSchema.employeeIds` — per-employee approval queries
- `bulkMembershipsRequestSchema.memberships` — per-company membership diff inside one transaction

**Fix:**

```ts
// ai.ts
toolCalls: z.array(nlCorrectionToolCallSchema).min(1).max(50);
messages: z.array(chatMessageSchema).min(1).max(40);
content: z.string().max(8000); // per message
// timesheets.ts
employeeIds: z.array(z.number().int().positive()).min(1).max(2000);
// auth.ts
memberships: z.array(...).max(500);
```

Caps are set well above realistic values (2000 employees is bigger than most CPA-firm client rosters; 50 tool calls is 10× a typical LLM preview).

---

## LOW findings (documented, not mitigated)

### LOW 1 — CSP disabled

`backend/src/http/app.ts`:

```ts
helmet({ contentSecurityPolicy: false });
```

Helmet otherwise sets `X-Frame-Options: SAMEORIGIN`, HSTS, `X-Content-Type-Options: nosniff`, and friends. CSP is off because the React SPA + dynamic AI-provider URLs don't fit a restrictive default policy.

Clickjacking is already mitigated by `X-Frame-Options`. A future polish pass could turn CSP on with `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; frame-ancestors 'none'`.

### LOW 2 — `esbuild` dev-dep advisory

`npm audit` reports 5 moderate advisories, all in dev-only tooling (`vite → esbuild → vite-node → vitest → @vitest/mocker`). Production (`npm audit --omit=dev`): **0 vulnerabilities**.

The advisory (GHSA-67mh-4wv8-2f99) only affects the Vite dev server's request-forwarding behaviour. It does not reach the compiled production bundle or the backend container. `npm audit fix --force` would require upgrading vite 5→8 (breaking). Accepted.

### LOW 3 — `JWT_SECRET` minimum length

`env.ts` requires `JWT_SECRET.min(32)`. For HS256, the recommendation is ≥32 bytes (64 hex chars). `.env.example` recommends `openssl rand -hex 64` (64 bytes / 512 bits), but the schema allows any 32-char string.

This is an operator-hygiene item: a 32-char all-lowercase-ASCII secret is ~150 bits of entropy, plenty to resist offline brute force. The README + `.env.example` already prescribe the right generation command. Upgrading the schema to require hex format would break existing installations that followed the .env.example correctly, so leaving as-is.

---

## What the audit confirmed is already good

### Authentication

- JWT `algorithm: 'HS256'` + `algorithms: ['HS256']` on both sign and verify — no alg-confusion attack possible.
- License verifier is RS256-only and refuses to verify without an explicit public key (no bundled dev key can sneak into prod).
- Access tokens 15 min, refresh tokens 30 days with atomic rotation + revoke-on-reuse detection (`rotateRefreshToken` SELECT FOR UPDATE).
- `authMethod` claim distinguishes password vs. magic-link sessions so only magic-link sessions can set a new password without supplying the old one.
- `change-password` revokes all refresh tokens on success.

### Brute-force + rate-limiting (post-fix)

- `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/magic/request`, `/auth/magic/consume`, `/auth/change-password`, `/auth/set-password` — all `authRateLimiter`.
- `/setup/initial` — `authRateLimiter`.
- `/kiosk/pair` — dedicated `pairLimiter` (5/min/IP) on the 8-digit pairing code.
- `/me/phone/verify-request` and `/verify-confirm` — `authRateLimiter`.
- `/notifications/phone-verification/request` and `/confirm` — `authRateLimiter` (added in Finding 3).
- Kiosk PIN entry — per-device in-memory lockout after `KIOSK_BAD_PIN_LIMIT` bad attempts.
- Kiosk badge scan — per-device scan-rate limiter before any HMAC work.
- Magic-link requests — 3/hour per normalized identifier (SMS and email).

### Injection + deserialization

- All SQL uses Knex query builder or `db.raw` with `?` placeholders. No string-concatenated SQL.
- No `child_process` / `spawn` / `exec` / `execSync` in production code.
- No `eval` / `Function()` / `new Function()`.
- No unsafe deserialization — everything is JSON.parsed.
- Email template interpolation HTML-escapes user-supplied values (prior hardening pass).
- Zod validates every request body, query, and params; invalid input fails fast with 400.

### SSRF / path traversal / redirect

- Magic-link origin validated against `CORS_ORIGIN` allowlist.
- Payroll-export file paths constructed server-side from `{companyId}/{serverGeneratedFileName}`; no user-supplied path fragment.
- No arbitrary URL-following other than the AI provider path (gated above).
- Tunnel manager writes to a fixed path (`update-control/tunnel-request.json`).

### Transport / headers

- `trust proxy: 1` is correct for the Caddy-sidecar deploy.
- `x-powered-by` disabled — no Express version fingerprint.
- Helmet default (sans CSP): HSTS, X-Content-Type-Options, X-Frame-Options, referrer-policy, no-sniff.
- CORS: explicit allowlist from `CORS_ORIGIN`, `credentials: true` required for bearer-token propagation through preflight.
- `express.json({ limit: '1mb' })` — caps body size across all routes.

### Crypto

- All random values use `crypto.randomBytes` or `crypto.randomUUID`. No `Math.random` in production.
- Passwords hashed with bcrypt cost 12 (~250 ms). PINs bcrypt cost 10 (interactive for kiosk). Both verified with `bcrypt.compare` (constant-time).
- AES-256-GCM for per-company Twilio/EmailIt/AI secrets, keyed by `SECRETS_ENCRYPTION_KEY` with a per-write random 12-byte IV.
- Badge HMAC uses SHA-256 truncated to 128 bits, HKDF-derived from `SECRETS_ENCRYPTION_KEY` (or separately provisioned via `BADGE_SIGNING_SECRET`).
- Refresh tokens: 48 bytes (384 bits) base64url, SHA-256 hashed in DB (only the hash; no recovery if the DB dumps).
- Magic-link tokens: 32 bytes (256 bits) base64url, SHA-256 hashed in DB, 15-min TTL, single-use.
- Pairing codes: 8 digits, 30-minute TTL, consume-atomically (SELECT FOR UPDATE).

### Dependency posture

- 758 packages total; **0 production vulnerabilities** (`npm audit --omit=dev`).
- 5 dev-only advisories (all esbuild chain), not shipped to users.
- All licenses permissive (verified by `scripts/license-audit.sh`).
- No vendored third-party code.

### Secret exposure

- Logger `redact` paths: `req.headers.authorization`, `password`, `passwordHash`, `pinHash`.
- Notifications log redacts `magic_link` / `password_reset` / `phone_verification` body payloads to `{ redacted: true }` (prior hardening pass).
- Error handler returns generic `internal_error` for unknown errors in prod (no stack trace leak).
- Magic-link request is a silent no-op for unknown identifiers — no user enumeration oracle.
- Login failure returns generic `Invalid email or password` — no "unknown email" vs "wrong password" distinction.

---

## Verification

```
$ npm run check          → typecheck + lint + format + license:headers clean
$ npm run license:audit  → AUDIT PASSED — 0 failures, 0 warnings
$ npm test               → 325/325 (94 shared + 227 backend + 4 frontend)
$ npm audit --omit=dev   → found 0 vulnerabilities
$ npm audit              → 5 moderate (all dev-only esbuild chain; see LOW 2)
```

---

## Re-run cadence

Run this audit when:

- Adding a new route that accepts URLs, file paths, or shell-exec-adjacent data.
- Adding any new outbound `fetch` / HTTP client.
- Upgrading `helmet` / `express` / `jsonwebtoken` / `bcrypt`.
- Adding a new JWT-issuing or JWT-verifying path.
- Adding a control-file IPC interaction (things in `update-control/`).
- A new `z.array(...)` field that a route handler will iterate.

Recommended hardening on top of today's fixes (future work, not required for release):

- Turn on a restrictive CSP in `helmet()` once the frontend's asset-loading story is finalized.
- Add an egress allowlist on the appliance firewall (rules for outbound: only the license portal, EmailIt, Twilio/TextLinkSMS, Anthropic API, GitHub releases).
- Integrate `gitleaks` or similar in CI to catch a future `.env` leak.
- Periodic re-run of `npm audit` in CI with a blocking threshold on HIGH/CRITICAL in production deps.
