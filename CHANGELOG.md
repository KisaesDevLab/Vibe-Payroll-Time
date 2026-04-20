# Changelog

All notable changes to **Vibe Payroll Time** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
