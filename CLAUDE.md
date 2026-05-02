# Vibe Payroll Time — CLAUDE.md

This file is the primary context document for Claude Code when working on **Vibe Payroll Time** (Vibe PT). Read it at the start of every session.

---

## What this is

A self-hosted, multi-tenant **employee time tracking** application for hourly/shift workers. Positioned between QuickBooks Time, OnTheClock, and Homebase — but narrower, simpler, self-hosted, and CPA-firm-friendly.

**Target users:**

- **Internal path:** CPA firm staff tracking their own hours (PolyForm Internal Use, free)
- **Commercial path (client-portal):** CPA firms reselling it to their small-business clients; small-business owners deploying the appliance direct (PolyForm commercial tier)

**Explicit non-goals (v1):**

- ❌ Payroll processing (gross-to-net, tax withholding, direct deposit, 941/940/W-2 filings) — export-only to Payroll Relief / Gusto / QBO Payroll / generic CSV
- ❌ Scheduling (shifts, templates, trades, availability, time-off requests, PTO accruals)
- ❌ GPS / geofencing / photo / biometric / device-binding — anti-buddy-punching is auth-based only
- ❌ Rate/wage data — hours only, no dollars anywhere in the system
- ❌ Professional-services billable-hours UX (timer-first, per-client billing) — this is a punch-in/out app
- ❌ Native iOS/Android apps — PWA only
- ❌ State-specific OT rules (CA daily OT, 7th day, split shift, meal penalties, predictive scheduling) — federal FLSA 40-hour-weekly only
- ❌ GL/accounting integration — shares server stack with Vibe MyBooks / Vibe TB but no data integration
- ❌ SMS without BYO Twilio — appliance is self-contained; customer supplies Twilio creds

---

## Stack

Identical to Vibe Trial Balance / Vibe MyBooks conventions unless noted.

| Layer         | Tech                                                                                                                                                                                                                                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, TanStack Table                                                                                                                                                                                                                                                                                                    |
| PWA           | Workbox, IndexedDB (offline punch queue), Background Sync API                                                                                                                                                                                                                                                                                                               |
| Backend       | Node.js 20, Express, Knex.js (plain JS migrations for Windows compat), Zod                                                                                                                                                                                                                                                                                                  |
| Database      | PostgreSQL 16                                                                                                                                                                                                                                                                                                                                                               |
| Queue / cron  | BullMQ + Redis 7 for scheduled background jobs (auto-clock-out, missed-punch reminders, license heartbeat, retention sweep). Phase 14 reversed the v1 "no BullMQ" stance for parity with sibling Vibe apps and to enable horizontal scaling under the appliance overlay. Standalone runs scheduler+worker in-process (single container); the appliance compose splits them. |
| Auth          | JWT (access + refresh), bcrypt for passwords, `otplib` for PIN TOTP rotation (kiosk)                                                                                                                                                                                                                                                                                        |
| AI            | Multi-provider LLM abstraction (ported from Vibe TB): Anthropic / Ollama / OpenAI-compatible                                                                                                                                                                                                                                                                                |
| Email         | EmailIt.com transactional API (BYO API key per company, appliance-wide fallback)                                                                                                                                                                                                                                                                                            |
| SMS           | Twilio SDK, BYO credentials per company                                                                                                                                                                                                                                                                                                                                     |
| Ingress       | Cloudflare Tunnel (`cloudflared`) and/or Tailscale Funnel, bundled as sidecar containers                                                                                                                                                                                                                                                                                    |
| Reverse proxy | Caddy (auto-TLS for non-tunnel deployments)                                                                                                                                                                                                                                                                                                                                 |
| Deployment    | Docker Compose, distributed as appliance for GMKtec NucBox M6 (Ubuntu Server 24.04 LTS)                                                                                                                                                                                                                                                                                     |
| QR decoding   | `@zxing/library` + `@zxing/browser` on the tablet; `qrcode` npm package server-side for generation                                                                                                                                                                                                                                                                          |
| PDF / print   | Print-based HTML with `@media print` — no puppeteer / headless chromium (same discipline as Phase 13 PDF exports)                                                                                                                                                                                                                                                           |
| Time format   | `shared/time-format/` — pure-function parser + formatter (decimal / HH:MM / labeled). Same module used by frontend and backend.                                                                                                                                                                                                                                             |

---

## Repository

- GitHub org: **KisaesDevLab**
- Repo: **Vibe-Payroll-Time**
- Package name in workspace: `vibe-payroll-time`
- Product domain: **vibepayrolltime.com** (TBD — confirm availability)

---

## Licensing

- Source license: **PolyForm Internal Use 1.0.0**
  - Free for internal staff-only use (CPA firm tracking its own hours)
  - Client-portal use (serving client companies on the same appliance) requires a commercial license
- Commercial tiers: align with Vibe MyBooks
  - Per-firm unlimited annual (priced by total employee seats across all companies)
  - Per-firm capped annual (priced by company count cap)
  - Per-company monthly
- License portal: **shared `kisaes-license-portal`** at `licensing.kisaes.com`
- In-app enforcement: JWT + bundled RSA public key, per-**company** license state (not per-appliance — the appliance hosts both free internal and paid client-portal companies)
- Philosophy: staff never locked out, paying customers over limits get warnings not lockouts, data export always accessible regardless of license state

---

## Architecture

### Multi-tenancy model

One appliance hosts **many companies**. This is the most important architectural fact.

```
Appliance (one Docker stack, one Postgres)
├── Super Admin (appliance-level, manages companies + global settings)
├── Company: "Kisaes CPA" (internal — free, staff-only)
│   ├── CompanyAdmin, Supervisors, Employees
│   └── License state: internal_free
├── Company: "Acme Plumbing" (client — commercial)
│   ├── CompanyAdmin, Supervisors, Employees
│   └── License state: licensed | trial | grace | expired
└── Company: "Bob's Landscaping" (client — commercial)
    └── ...
```

Every tenant-scoped table carries `company_id`. Row-level isolation is enforced at the service layer (Knex query builders composed with company scope), not PG RLS — keeps migrations simple and debugging straightforward.

### Auth surfaces

Three distinct login paths:

1. **SuperAdmin / CompanyAdmin / Supervisor** → web login (email + password, JWT)
2. **Employee personal-device** → web login (magic link or password), PWA install on employee phone
3. **Kiosk mode** → device-paired kiosk token. Employee identifies with PIN (4–6 digits), QR badge scan, or both — admin picks `kiosk_auth_mode` per company. Badge payloads are HMAC-signed with an appliance-wide secret (derived from `SECRETS_ENCRYPTION_KEY` via HKDF, overridable with `BADGE_SIGNING_SECRET`) and verified server-side; raw payloads exist only on the printed badge.

Admin toggles per-company: "personal device only", "kiosk only", "both allowed". Default for internal path = personal device; default for client-portal = both.

### Punch model

```
time_entry (
  id, company_id, employee_id,
  shift_id,           -- groups a continuous sequence of work/break/job-switch entries into one "shift"
  entry_type,         -- 'work' | 'break'
  job_id,             -- nullable; set on 'work' entries if job tracking enabled
  started_at, ended_at, duration_seconds,
  source,             -- 'kiosk' | 'web' | 'mobile_pwa'
  source_device_id,   -- kiosk device id OR user agent hash
  created_by, edited_by, edit_reason,
  approved_at, approved_by,
  is_auto_closed      -- true if closed by auto-clock-out cron
)
```

Mid-shift job switch: close current `work` entry (ended_at = now), open new `work` entry with new `job_id` (started_at = now), same `shift_id`. A "shift" is reconstructable as all entries sharing a `shift_id`.

Only **one open entry** per employee may exist at any time — enforced with a partial unique index.

Manual entries use `source = web_manual` and carry an `entry_reason`. A manual entry may supersede one or more punch entries for the same (employee, day, job); superseded entries remain in the DB with their `superseded_by_entry_id` set, never deleted. The "active" view of a timesheet is entries where `superseded_by_entry_id IS NULL`. Deleting a manual entry restores its superseded punches in the same transaction.

### Time format is always a display concern

Storage is `BIGINT seconds`, always. No cell in the UI, no column in a report, and no input field ever stores formatted time strings. The `shared/time-format/` module parses input strings to seconds and formats seconds to strings; frontend and backend import the same module so their validation agrees. User preference (`decimal | hhmm`) falls back to company default; both are display settings that never touch entry data.

### Time math is always derived, never stored

Durations, rounded durations, daily totals, weekly totals, OT, and pay-period totals are computed from raw `time_entry` rows every read. Rounding and OT rules are **company settings**, not entry properties — so a retro rule change correctly re-computes historical timesheets.

Rounding engine runs at display/report time only. Raw punches always preserved.

### Audit trail is mandatory

Every edit to a `time_entry` writes a `time_entry_audit` row (who, when, field, old, new, reason). Every punch carries its source. This is non-negotiable — CPA firms will not resell anything without a defensible audit trail.

---

## Conventions

### Durations as integer seconds

All durations stored as **BIGINT seconds** (not minutes, not cents). Matches the BIGINT-cents discipline from Vibe TB — integer math, no float drift.

### Timestamps as UTC

All `*_at` columns are `TIMESTAMPTZ` stored in UTC. Company timezone applied at render/report time only. Never trust client-local time — server stamps every punch with `NOW()`.

### Timezone source

Company timezone is a required setting. All pay period math, daily boundaries, and week-start logic resolves in the company's timezone.

### Migrations

- Plain JS (`.js`, not `.ts`) for Windows compatibility — same rule as Vibe TB
- Path: `backend/migrations/`
- Naming: `YYYYMMDDHHMMSS_description.js`
- Never edit an applied migration; add a new one

### API shape

- REST, `/api/v1/...`
- Zod validates every request body and query
- Errors: `{ error: { code, message, details? } }` with proper HTTP status
- Responses: `{ data, meta? }` — wrapping enables envelope changes later without breakage

### Frontend conventions

- TanStack Query for all server state
- TanStack Table for all tabular views (time cards, audit trail, reports)
- No component library — Tailwind + hand-rolled components (same as Vibe TB)
- Tax mapping / TB grid pattern: keep related-but-distinct views as separate pages, not tabs

### PWA and offline

Kiosk mode and personal-device mode **both** need offline punch capability — Wi-Fi hiccups at a shared kiosk are common, and a phone on cellular in a basement is common.

Offline punch queue:

- IndexedDB stores pending punches with local timestamps
- Background Sync API flushes on reconnect
- Server accepts punches with `client_started_at` + `client_clock_skew` metadata, stamps its own `started_at` based on client time adjusted for clock skew, and flags the entry as `source_offline = true`
- Conflict resolution: if two offline punches would create overlapping open entries, second one is rejected and surfaced as an exception on the employee's timesheet

### AI feature scope

Two AI features only for v1:

1. **Natural-language timesheet corrections** — "move last Tuesday 2–4pm to job 1204". Tool-calling against the same edit endpoints employees/managers already use. Always shows a diff preview before applying.
2. **AI support chat** — same pattern as Vibe TB. RAG over bundled user docs. Never has write access to anything.

Company-level toggle disables both. When disabled, the LLM abstraction is never called.

---

## Dev commands

```bash
# Boot everything
docker compose up -d

# Run migrations
npm run migrate --workspace=backend

# Create a new migration
npm run migrate:make --workspace=backend -- <name>

# Start dev servers (with hot reload)
npm run dev                 # both frontend and backend concurrently
npm run dev:backend
npm run dev:frontend

# Tests
npm test                    # all
npm run test:backend
npm run test:frontend

# Typecheck + lint
npm run check               # tsc --noEmit && eslint

# Build production images
docker compose -f docker-compose.prod.yml build
```

---

## Common pitfalls (learn from Vibe TB)

- **Don't store computed time math.** Always derive durations, OT, and pay-period totals from raw `time_entry` rows. Storing them means retro rule changes break historical reports.
- **Don't trust client timestamps for authoritative punch time.** Client time is metadata; server `NOW()` is truth. Exception: offline-queued punches (see PWA section).
- **Don't let two open entries coexist for one employee.** Partial unique index is non-negotiable.
- **Don't let an approved timesheet be edited by an employee.** Lock at approval; correction requests go through the supervisor/admin edit path.
- **Don't hardcode pay period boundaries.** Weekly, bi-weekly (with anchor date), semi-monthly (1–15 / 16–end), monthly — all four must work from day one.
- **Don't forget timezone for week-start.** "Sunday week start" in Pacific is not the same instant as "Sunday week start" in Eastern. Always resolve in company timezone.
- **Don't let the kiosk session carry an admin JWT.** Kiosk has its own token scope — can look up employees by PIN and create punches, nothing else.
- **Don't leak `company_id` scoping.** Every service method must take `companyId` as an explicit argument, never infer from request context deep in the call stack.
- **Don't write AI features that take write actions without confirmation.** NL corrections always show diff preview. Support chat has zero write capability.
- **Don't forget the audit trail on every edit path.** Every function that modifies `time_entry` goes through one choke point that writes the audit row.
- **Don't store raw badge payloads server-side.** Only `sha256(payload)` lives in the DB (on `employees.badge_token_hash`); the plaintext payload exists exactly once in the API response to `issueBadge` and then only on the printed badge. If the admin dismisses the post-issue modal, reissue — don't try to recover the old one.
- **Don't skip the `badge_version` check.** Reissuing a badge must invalidate every prior physical badge immediately, not on next verification. `verifyBadge` compares the parsed version to `employees.badge_version` after the HMAC check.
- **Don't request camera permission outside of kiosk pairing.** A personal-device PWA should never ask for camera — badges are kiosk-only for v1.
- **Don't forget the audit event on scan failures.** Silent failures are how shared-badge abuse goes undetected; every bad scan — bad HMAC, cross-company, revoked, version mismatch, rate-limited — logs to `badge_events` with its reason.
- **Don't parse time-format strings with regex in route handlers.** Every route that accepts an hours field runs the input through `shared/time-format/parseHours` and stores the returned seconds. Never ad-hoc.
- **Don't round seconds to minutes on storage.** Storage is always exact seconds; only display rounds (to whole minutes for HH:MM, to configurable precision for decimal).
- **Don't silently normalize ambiguous input.** `"5 48"` (whitespace-separated numbers) is ambiguous and must return an error. Guessing is how manual entries become wage-and-hour claims.
- **Don't hard-delete a manual entry.** Soft-delete via `deleted_at`; restoration of superseded punches must happen in the same transaction so a crash between steps can't leave the punch dangling.
- **Don't let a grid re-render without reading the user's current format preference.** Format is resolved server-side on every grid-payload response (`timeFormat` field) so client and server always agree.

---

## Related projects

- **Vibe Trial Balance** (KisaesDevLab/Vibe-Trial-Balance) — tax workpaper app; shares stack conventions, multi-provider LLM abstraction, four-level backup pattern, SEO/landing-page approach
- **Vibe MyBooks** (vibemb.com) — bookkeeping app; shares PolyForm licensing, `kisaes-license-portal`, JWT enforcement middleware pattern, grace-period state machine, appliance deployment playbook
- **kisaes-license-portal** — Stripe-powered license vending at `licensing.kisaes.com`; same one services Vibe PT

## Where to look when you're stuck

1. `BUILD_PLAN.md` — the phased checklist; find the current phase and the specific item
2. `CHANGELOG.md` — what v1.0.0 actually shipped with, grouped by phase
3. `docs/` — operator + user-facing guides (`admin-guide`, `employee-guide`, `kiosk-setup`, `integrations`, `security`, `security-review`, `restore`, `troubleshooting`, `deployment`, `exports/`)
4. Vibe MyBooks source for: JWT enforcement, license state machine, company/employee data patterns
5. Vibe TB source for: LLM abstraction, migrations style, TanStack Table patterns, four-level backup
6. This file

---

## v1.0.0 decisions worth knowing

Changes from the pre-v1 BUILD_PLAN assumptions, captured so they don't drift:

- **Phase 14 reversed "BullMQ not used v1".** The four background jobs (auto-clockout, missed-punch, license heartbeat, retention sweep) now run through BullMQ + Redis. The `run*()` business functions in `services/` stayed put; only the transport changed. Standalone customers gain a Redis container in `docker-compose.yml` but no operator behavior changes (`WORKER_ROLE=all` keeps scheduler+consumer in-process).
- **Phase 14 env renames are deprecation-aliased, not hard renames.** `CORS_ORIGIN`→`ALLOWED_ORIGIN` and `MIGRATE_ON_BOOT`→`MIGRATIONS_AUTO`. Both names work; if only the legacy name is set, a single `[deprecated]` log line fires at boot. Removal target: a future minor release.
- **Phase 14 image-rename: dual-publish.** GHCR now publishes both `vibe-payroll-time-{server,client}` (new canonical) and `vibe-payroll-{api,web}` (legacy aliases) for one minor-release cycle. `docker-compose.prod.yml` continues to reference the legacy names so existing customers' upgrades are no-ops; the appliance overlay uses the new names.

- **Email transport is EmailIt.com, not Nodemailer.** Fetch-based HTTP client, BYO API key per company, appliance-wide fallback. Rationale: no SMTP relay to run, good per-tenant API-key story, one less moving piece.
- **Licensing ships disabled (`LICENSING_ENFORCED=false`).** The machinery is wired end-to-end but the middleware short-circuits. Flip to `true` once the license portal is live for this product.
- **No license public key is bundled in the image.** `LICENSE_PUBKEY_PEM` must be set explicitly before enforcement will accept any JWT. Prevents a leaked dev key from signing prod licenses.
- **Four-level backup:** Level 1 = WAL archive (continuous), Level 2 = `pg_dump` nightly, Level 3 = rclone to S3 weekly, Level 4 = per-company logical ZIP on demand. See `docs/restore.md`.
- **Retention sweep** runs nightly at 03:41 UTC and prunes `auth_events` (365d), `notifications_log` (180d), `ai_correction_usage` (90d), `kiosk_pairing_codes` (30d), and export files on disk (365d). `time_entries` + `time_entry_audit` are never pruned.
- **PDF export is print-based**, not server-rendered. `@media print` CSS + a Print/PDF button that opens the browser's Save-as-PDF dialog. Rationale: no puppeteer, no headless chromium, works on constrained appliances.
- **SuperAdmin appliance health** is a single `/admin/health` endpoint + a `/appliance` dashboard route. No Prometheus / external observability in v1.
- **Types:** we renamed `time-math/summary.ts` exports to `DaySummaryInternal` + `WeekSummaryInternal` to avoid a collision with HTTP types in `schemas/timesheets.ts`. Don't re-export `LicenseState` from `schemas/licensing.ts` — it lives in `enums.ts`.
- **tsconfig:** no `composite: true`, no project references. `tsc --noEmit` at build time; `tsx` at runtime for both dev and prod.
