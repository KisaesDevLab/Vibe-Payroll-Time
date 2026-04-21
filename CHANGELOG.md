# Changelog

All notable changes to **Vibe Payroll Time** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — Cross-company admin + account recovery + release hardening

- **Cross-company users view** (`/appliance/users`): SuperAdmin-only matrix-style
  editor lists every user account on the appliance with their memberships and
  roles. Bulk-reconcile endpoint diffs desired-vs-current memberships in one
  atomic transaction (`POST /admin/users/:userId/memberships`)
- **Account recovery without current password**: magic-link sign-in mints a
  session tagged `authMethod: 'magic_link'`; `POST /auth/set-password`
  accepts a new password without the current one for those sessions. Regular
  `POST /auth/change-password` still requires the current password
- **User-level phone + verification** (`/me/phone`): separate from per-company
  `employees.phone`. Uses the appliance-level SMS provider so SuperAdmins can
  verify without a company context. Magic-link-by-SMS accepts either the
  user-level phone OR any verified employee phone
- **Cloudflare tunnel management** (`/admin/tunnel`): enable/disable + token
  rotation via a control-file pattern. Host-side systemd path unit watches
  `update-control/tunnel-request.json` and reconciles the compose profile
- **Custom appliance branding**: operator-set display name flows through
  TopBar, login page, emails, SMS, and diagnostic test sends via
  `getResolvedDisplayName()` — no more UUIDs in customer-facing messages
- **Appliance health dashboard "Seed demo" button**: idempotent demo-company
  install with six employees and two weeks of entries
- Timezone dropdown in the setup wizard + per-company settings (IANA list
  with US-pinned defaults)
- SuperAdmin phone entry during first-run setup
- Kiosk pairing card moved from Employees → Kiosks tab

### Changed

- **`memberships` now carry `isEmployee`**: the TopBar's "My time" / "Timesheet"
  links only render for users with an active `employees` row; the punch
  endpoints still reject 403 server-side, but the UI no longer surfaces a
  dead-end link for admin-only SuperAdmins
- **Notification providers**: EmailIt upgraded to v2 API (`from` as
  `"Name <email>"` string, `to` as string). TextLinkSMS corrected to
  `phone_number` / `text` body fields with outcome signalled via JSON
  `body.ok` (HTTP always 200)
- **E.164 normalization at every phone write boundary**: `normalizeToE164()`
  canonicalizes before store so `"(417) 737-7937"` and `"+14177377937"` route
  identically through TextLinkSMS's paired Android SIM (which silently drops
  non-E.164)
- **Interactive notifications bypass `NOTIFICATIONS_DISABLED`**: magic-link,
  password reset, and phone verification always send regardless of the
  background-send stub flag
- **Setup gate hardened**: `installation_id` WHERE-guard on first write PLUS
  an `anySuperAdminHasExisted()` check closes the "disable the sole admin to
  reopen the wizard" backdoor
- **Magic-link origin** is now derived from the client's `window.location`
  validated against the `CORS_ORIGIN` whitelist, so links no longer point at
  the backend port (`:4000`) in dev or the internal Caddy host in prod
- **Frontend on port 5180** (was 5173) to avoid collision with Vibe MyBooks
  on CPA-firm workstations that run both
- **`apiFetch` handles 204 No Content**: empty-body 2xx responses now
  resolve cleanly instead of failing JSON parse

### Security

- **Notification log redaction**: `notifications_log.payload` now stores
  `{ redacted: true }` for `magic_link` / `password_reset` /
  `phone_verification` rows instead of the rendered SMS body. A
  CompanyAdmin with log access can no longer copy another user's magic link
  out of the log and sign in as them
- **Template HTML escaping**: interpolated template vars (`firstName`,
  `reason`, `reviewNote`, custom `appName`) are HTML-escaped when rendered
  into email HTML. Template tags themselves remain trusted
- **Offline queue clears on user switch**: if the logged-in user id changes,
  the pending-punch IndexedDB store is cleared so a shared-device logout →
  new-user login can't flush the prior user's queued punches under the new
  session
- **Offline queue drain guarded against concurrent runs**: a boot tick, an
  `online` event, and an authStore subscriber tick firing within a few ms
  would each have read the pending set before the others deleted their
  items, double-posting the same punch
- Runtime guard `assertPointedAtTestDb()` in every integration-test
  `beforeAll` — prevents integration tests from accidentally truncating the
  dev DB when the vitest env override misses

### Added — Phase 4.5 QR badge authentication

- Employees gain four nullable badge columns (`badge_token_hash`,
  `badge_issued_at`, `badge_revoked_at`, `badge_version`) and a partial
  unique index on `(company_id, badge_token_hash) WHERE badge_revoked_at IS NULL`
- `company_settings.kiosk_auth_mode` ENUM (`pin` | `qr` | `both`, default `pin`)
- New `badge_events` table (issue / revoke / scan_success / scan_failure)
- Badge token format `vpt1.{companyId}.{employeeId}.{version}.{nonce}.{hmac}`;
  HMAC-SHA256 truncated to 128 bits, keyed via new optional `BADGE_SIGNING_SECRET`
  env var (HKDF-derived from `SECRETS_ENCRYPTION_KEY` if unset)
- `issueBadge` / `revokeBadge` / `bulkIssueBadges` / `verifyBadge` service
  with per-kiosk scan rate limit (20 scans/min → 60 sec cooldown)
- Admin API: `POST /employees/:id/badge/issue`, `/revoke`;
  `GET /employees/:id/badge`, `/badge/events`;
  `POST /employees/bulk-badges` returns the rendered print sheet
- Kiosk API: `POST /kiosk/scan` returns the same `KioskEmployeeContext` shape
  as PIN verify; `GET /kiosk/me` now includes the current `kiosk_auth_mode`
- Frontend kiosk UI renders `BadgeScanner` (zxing + getUserMedia) when auth
  mode is `qr` or `both`, with PIN fallback link in `both`
- Admin UI: Employees roster gets a Badge column + row-select + bulk Issue
  action; the employee drawer gains Issue / Reissue / Revoke + last-10-event
  panel; Company settings → Punch rules radio for the mode
- Docs: `docs/kiosk-setup.md`, `docs/security.md`, `docs/admin-guide.md` all
  gained dedicated badge sections
- Tests: 13 new unit tests (badge HMAC + lockout) and 8 integration tests
  covering issue / reissue / revoke / cross-company / tamper / version /
  rate-limit paths

### Changed

- `PairKioskResponse` and `GET /kiosk/me` include `kioskAuthMode` so a
  tablet re-renders to the right screen without re-pairing when an admin
  flips the setting
- `backend/migrations/package.json` declares the migrations folder as
  CommonJS so knex can load the ESM-parent-package migrations natively
- `backend/src/db/knex.ts` resolves the migrations directory via
  `fileURLToPath` to avoid Windows double-prefix path bugs

## [1.0.0] — 2026-04-20

Initial public release. Self-hosted, multi-tenant employee time-tracking
appliance targeting CPA firms (internal-use free) and CPA firms reselling
to small-business clients (commercial tier).

### Added

**Appliance (Phase 0–1)**

- Docker Compose production stack with profiles for public, Cloudflare Tunnel,
  and Tailscale Funnel ingress
- Caddy reverse proxy with automatic TLS for the public profile
- Installer, updater, and backup scripts for Ubuntu Server 24.04 on the
  GMKtec NucBox M6 reference hardware

**Core domain (Phase 2–5)**

- Multi-tenant model: one appliance, many companies, row-level isolation at
  the service layer via explicit `companyId` scoping
- Punch engine with single chokepoint, `pg_advisory_xact_lock` per employee,
  partial unique index on open entries, append-only audit
- Four auth surfaces: SuperAdmin, CompanyAdmin/Supervisor, personal-device
  PWA (magic link), kiosk with 4–6 digit PIN
- Offline queue for PWA + kiosk punches via IndexedDB + clock-skew detection
- Kiosk pairing with 8-digit codes and device tokens

**Timesheets + pay periods (Phase 6–8)**

- Raw-punch-derived durations, weekly/bi-weekly/semi-monthly/monthly pay
  periods, FLSA 40-hour weekly OT
- Company rounding policies applied at render time
- 5 built-in reports: time card, hours by period, hours by job, overtime,
  audit trail — all streaming CSV
- Employee correction-request flow → supervisor/admin approve path

**Payroll exports (Phase 9)**

- Four formats: Payroll Relief, Gusto, QBO Payroll, Generic CSV
- Preflight with open-shift + payroll-code checks
- Per-export history with redownload

**Notifications (Phase 10)**

- EmailIt.com as the default email transport (fetch-based, per-company BYO
  API key with appliance-wide fallback)
- Twilio SMS with 6-digit phone verification, per-employee opt-in
- Missed-punch reminders + correction-event notifications
- Notifications log with filtering by status / channel

**AI (Phase 11)**

- Multi-provider abstraction: Anthropic, OpenAI-compatible, Ollama
- Natural-language timesheet corrections with diff-preview-first UX
- Support chat bot (RAG over bundled user docs, zero write capability)
- Per-company enable/disable; when off, no provider is called

**Licensing (Phase 12)**

- RS256 JWT verification from `kisaes-license-portal`
- Per-company states: `internal_free | trial | licensed | grace | expired`
- Master `LICENSING_ENFORCED` flag (**off by default** — v1 ships pre-live)
- Grace period does not block reads or exports; expired blocks mutations only

**Ops + release (Phase 13)**

- Level-1 PostgreSQL WAL archiving
- Level-3 weekly S3 backup script (rclone-based, any S3-compatible remote)
- Level-4 on-demand per-company export-everything ZIP (SuperAdmin)
- Restore script + quarterly restore drill doc
- Nightly retention sweep (auth events, notifications log, AI usage, export files)
- SuperAdmin appliance health endpoint + dashboard
- Operator + user documentation:
  `admin-guide`, `employee-guide`, `kiosk-setup`, `integrations`, `security`,
  `security-review`, `restore`, `troubleshooting`
- Print-to-PDF report flow (`@media print` CSS + Print button)

### Security

- AES-256-GCM envelope encryption for stored secrets, v1 envelope format
  (`v1.iv.tag.ct`, base64url)
- bcrypt cost 12 for user passwords, cost 10 for kiosk PINs
- HKDF-derived HMAC-SHA256 PIN fingerprint for O(1) kiosk lookup without
  widening bcrypt surface
- JWT access (15 min HS256) + refresh (30 day, SHA-256 hashed, atomic rotate)
- Zod validation on every HTTP body / query param
- helmet + CORS + rate-limiting on all auth-facing routes

### Known limitations (explicit non-goals for v1)

- No payroll processing — exports only
- No scheduling (shifts, trades, availability)
- No GPS / geofencing / photos / biometrics — auth-based anti-buddy-punching only
- No rate / wage data — hours only
- No state-specific OT rules beyond federal FLSA 40-hour
- No native iOS / Android app — PWA only
- No GL / accounting integration with Vibe MyBooks / Vibe TB

See `BUILD_PLAN.md` for the roadmap beyond v1.
