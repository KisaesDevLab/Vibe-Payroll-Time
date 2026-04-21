# Changelog

All notable changes to **Vibe Payroll Time** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
