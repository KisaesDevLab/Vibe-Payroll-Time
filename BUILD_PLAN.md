# Vibe Payroll Time — Build Plan

Phased, checklist-driven build plan. Same pattern as Vibe Trial Balance. Work phases sequentially; inside a phase, items can be parallelized unless otherwise noted. Mark items `[x]` as completed. Do not skip phases — each depends on the integrity of the previous.

**Locked scope reference:** See `CLAUDE.md` for non-goals. If an item below conflicts with a non-goal, the non-goal wins.

---

## Phase 0 — Foundation

Goal: a working dev loop on Kurt's laptop. One command brings up frontend + backend + Postgres.

- [ ] Initialize GitHub repo `KisaesDevLab/Vibe-Payroll-Time`
- [ ] Add `LICENSE` (PolyForm Internal Use 1.0.0) and `LICENSE-COMMERCIAL.md` stub
- [ ] Add `README.md` with one-paragraph overview and link to CLAUDE.md
- [ ] Add `CLAUDE.md` (already drafted)
- [ ] Add `BUILD_PLAN.md` (this file)
- [ ] Initialize npm workspace: `backend/`, `frontend/`, `shared/`, `scripts/`
- [ ] `shared/`: TS types shared between frontend and backend (zod schemas, enums, constants)
- [ ] Backend scaffold: Node 20, Express, TypeScript, Knex, Zod, Pino, dotenv-flow
- [ ] Frontend scaffold: React 18, Vite, TypeScript, Tailwind, TanStack Query, TanStack Table, React Router
- [ ] `tsconfig.base.json` extended by workspace tsconfigs
- [ ] ESLint + Prettier configs (identical rules across workspaces)
- [ ] `.editorconfig`, `.gitignore`, `.gitattributes`
- [ ] Pre-commit hook (husky + lint-staged): typecheck, lint, format
- [ ] `docker-compose.dev.yml`: Postgres 16, pgAdmin (optional), backend hot-reload, frontend vite dev server
- [ ] `.env.example` committed; `.env` gitignored
- [ ] `npm run dev` script at root runs backend + frontend concurrently
- [ ] `npm run check` runs tsc + eslint across all workspaces
- [ ] GitHub Actions CI: install, check, test on push/PR
- [ ] `CONTRIBUTING.md` with branching conventions and commit message format
- [ ] Smoke test: backend responds at `GET /api/v1/health`, frontend loads at `localhost:5173`

## Phase 1 — Appliance deployment plumbing

Goal: production Docker stack that mirrors how the appliance will run on a NucBox M6.

- [ ] Multi-stage `Dockerfile` for backend (build → slim runtime, non-root user)
- [ ] Multi-stage `Dockerfile` for frontend (build → nginx-alpine serving `dist/`)
- [ ] `docker-compose.prod.yml`: Postgres 16 with named volume, backend, frontend, Caddy reverse proxy
- [ ] Caddy config: auto-HTTPS for custom domain, reverse-proxy `/api` to backend, static for frontend
- [ ] **Cloudflare Tunnel sidecar**: `cloudflared` service in compose, takes tunnel token from env, routes to Caddy
- [ ] **Tailscale Funnel sidecar** (alternative): `tailscale` service, auth key from env, funnel on :443
- [ ] `scripts/appliance/install.sh`: one-shot installer for Ubuntu 24.04 (installs Docker, clones repo, creates `.env` from template, runs compose)
- [ ] `scripts/appliance/update.sh`: `git pull`, `docker compose pull`, `docker compose up -d`, run migrations
- [ ] `scripts/appliance/backup.sh`: pg_dump + volume snapshot to a local directory
- [ ] Health endpoints: `/api/v1/health` (liveness), `/api/v1/health/ready` (DB connectivity, migrations current)
- [ ] Version endpoint: `/api/v1/version` (git SHA, build date)
- [ ] Structured logging to stdout (Pino, JSON in prod, pretty in dev)
- [ ] Crash-safe DB init: backend waits for Postgres ready before starting
- [ ] Knex migration runner wired into backend startup (configurable via env flag)
- [ ] First-run detection: if no SuperAdmin exists, surface setup wizard routes
- [ ] `docs/deployment.md`: step-by-step NucBox M6 install (Ubuntu, Docker, clone, env, tunnel token)

## Phase 2 — Multi-tenancy and auth core

Goal: the appliance understands SuperAdmin, companies, users, employees, and the row-level scoping discipline that governs every query for the rest of the project.

- [ ] Migration: `appliance_settings` (singleton table: timezone_default, feature_flags, installation_id)
- [ ] Migration: `users` (id, email, password_hash, role_global ENUM `super_admin`|`none`, created_at, last_login_at, disabled_at)
- [ ] Migration: `companies` (id, name, slug, timezone, week_start_day, pay_period_type, is_internal, license_state, license_expires_at, created_at, disabled_at)
- [ ] Migration: `company_memberships` (user_id, company_id, role ENUM `company_admin`|`supervisor`|`employee`, created_at) — one user can belong to many companies
- [ ] Migration: `employees` (id, company_id, user_id NULL, first_name, last_name, employee_number, email, phone, pin_hash, status ENUM `active`|`terminated`, hired_at, terminated_at) — `user_id` nullable because kiosk-only employees don't need accounts
- [ ] Migration: partial unique index on `(company_id, pin_hash)` where status = active
- [ ] Password hashing: bcrypt, cost factor 12
- [ ] PIN hashing: bcrypt, cost factor 10 (faster verification on kiosk)
- [ ] Auth service: `loginWithPassword`, `issueAccessToken`, `issueRefreshToken`, `rotateRefreshToken`, `revokeRefreshToken`
- [ ] JWT access tokens: 15-min expiry, signed with HS256 (appliance secret)
- [ ] Refresh tokens: 30-day expiry, stored hashed in `refresh_tokens` table, revocable
- [ ] Middleware: `requireAuth`, `requireRole(role)`, `requireCompanyRole(companyId, role)`, `requireSuperAdmin`
- [ ] **Company scoping discipline:** every service function that touches company-scoped data takes `companyId` as first arg after user; no implicit scoping from JWT deep in the stack
- [ ] Rate limiting on `/auth/*` endpoints (express-rate-limit, 10/min per IP)
- [ ] Audit logging table `auth_events` (user_id NULL, company_id NULL, event_type, ip, user_agent, created_at, metadata JSONB)
- [ ] First-run wizard backend: `POST /api/v1/setup/initial` (creates SuperAdmin + first Firm company, only works when no SuperAdmin exists)
- [ ] First-run wizard frontend: three-step form (appliance info → SuperAdmin account → first company)
- [ ] Admin can create/invite additional SuperAdmins
- [ ] Session refresh flow on frontend (silent refresh before access token expiry)
- [ ] Logout: revoke refresh token, clear tokens client-side
- [ ] Unit tests for auth service (login, rotation, revocation, role checks)
- [ ] Integration test: full login → access protected endpoint → refresh → logout

## Phase 3 — Company and employee management

Goal: admins can configure companies end-to-end and manage the people who will punch.

- [ ] Migration: `company_settings` (company_id PK, punch_rounding_mode ENUM `none`|`1min`|`5min`|`6min`|`15min`, punch_rounding_grace_minutes, auto_clockout_hours, missed_punch_reminder_hours, supervisor_approval_required, allow_self_approve, kiosk_enabled, personal_device_enabled, twilio_account_sid, twilio_auth_token_encrypted, twilio_from_number, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, smtp_from)
- [ ] Encryption at rest for Twilio/SMTP secrets: AES-256-GCM with an appliance-wide key in env
- [ ] Migration: `jobs` (id, company_id, code, name, description, is_active, created_at, archived_at) — "job" = job/project/customer code; terminology is "job" in UI
- [ ] CRUD endpoints: companies (SuperAdmin only)
- [ ] CRUD endpoints: company_memberships (CompanyAdmin can invite/remove users within their company)
- [ ] CRUD endpoints: employees (CompanyAdmin, scoped to their companies)
- [ ] CRUD endpoints: jobs (CompanyAdmin)
- [ ] Employee import via CSV (`employee_number`, `first_name`, `last_name`, `email`, `phone`)
- [ ] PIN generation: auto-generate unique 4–6 digit PIN per employee on creation; admin can regenerate; PIN uniqueness enforced per company
- [ ] Employee deactivation/reactivation (soft delete via `status`)
- [ ] Bulk actions: deactivate, regenerate PINs, export roster
- [ ] Frontend: SuperAdmin dashboard listing all companies with license state and employee count
- [ ] Frontend: Company settings page (one page with tabbed sections: General, Punch Rules, Pay Period, Approval, Notifications, Integrations)
- [ ] Frontend: Employee roster table (TanStack Table, sortable, filterable, bulk-select)
- [ ] Frontend: Employee detail drawer (edit form, PIN display/regenerate, status toggle, user-account link)
- [ ] Frontend: Job list page (CRUD, archive/unarchive)
- [ ] Validation: pay_period_type changes require confirmation modal (future pay periods affected)
- [ ] Validation: auto_clockout_hours between 4 and 24
- [ ] Validation: punch_rounding_grace_minutes between 0 and rounding mode's max (e.g. can't have 10-min grace on 5-min rounding)
- [ ] Tests: role isolation (supervisor can't edit company settings, employee can't view roster)

## Phase 4 — Auth surfaces

Goal: three working login paths — admin/supervisor web, employee personal device, kiosk.

- [ ] Frontend: standard email+password login at `/login` (admin/supervisor/employee-with-account)
- [ ] Magic-link login option for employees (email-only, clickable link → short-lived auth code → JWT)
- [ ] "Remember this device" — extended refresh token (90 days) for personal devices only
- [ ] PWA manifest: app name "Vibe Payroll Time", icon, theme color, display standalone, scope /
- [ ] PWA install prompt logic (personal-device mode only)
- [ ] Service worker registration (defer full offline to Phase 5)
- [ ] Kiosk mode: device pairing flow
  - [ ] Admin generates a one-time pairing code in company settings
  - [ ] Unpaired tablet navigates to `/kiosk/pair`, enters code, receives long-lived `kiosk_device_token`
  - [ ] Pairing code expires in 15 min; single-use
- [ ] Migration: `kiosk_devices` (id, company_id, name, token_hash, paired_at, last_seen_at, revoked_at)
- [ ] Admin UI: list of paired kiosk devices, rename, revoke
- [ ] Kiosk auth middleware: validates `kiosk_device_token`, scopes request to device's company, allows only kiosk endpoints (employee lookup by PIN, create punch, read own employee's today-summary)
- [ ] Kiosk UI: full-screen PWA
  - [ ] PIN keypad (large touch targets, numeric only)
  - [ ] On valid PIN: show employee name + current status + action buttons (Clock In / Clock Out / Break In / Break Out / Switch Job)
  - [ ] 10-second confirmation screen after punch, then back to PIN entry
  - [ ] Auto-lock to PIN screen after 30 sec of inactivity
- [ ] Kiosk error handling: invalid PIN, rate-limit on bad PINs (3 failures → 30-sec lockout, logged)
- [ ] Personal-device employee UI: single-screen punch interface (current status, big button, job selector if enabled)
- [ ] Per-company admin setting: `kiosk_enabled`, `personal_device_enabled` — at least one must be true
- [ ] Password reset flow (email-based, time-limited token)
- [ ] Tests: kiosk token can't access admin endpoints; admin token can't clock in an employee without proper role

## Phase 5 — Punch engine

Goal: the core of the system — accurate, atomic, auditable punches from any source, with offline resilience.

- [ ] Migration: `time_entries` (id, company_id, employee_id, shift_id UUID, entry_type ENUM `work`|`break`, job_id NULL, started_at TIMESTAMPTZ, ended_at TIMESTAMPTZ NULL, duration_seconds BIGINT NULL, source ENUM `kiosk`|`web`|`mobile_pwa`, source_device_id, source_offline BOOLEAN, client_started_at TIMESTAMPTZ NULL, client_clock_skew_ms INTEGER NULL, created_by INTEGER, edited_by INTEGER NULL, edit_reason TEXT NULL, approved_at TIMESTAMPTZ NULL, approved_by INTEGER NULL, is_auto_closed BOOLEAN, created_at, updated_at)
- [ ] Migration: partial unique index — only one open entry per employee at a time
- [ ] Migration: index on `(company_id, employee_id, started_at)` for timesheet reads
- [ ] Migration: `time_entry_audit` (id, time_entry_id, company_id, actor_user_id, action ENUM `create`|`edit`|`approve`|`unapprove`|`delete`|`auto_close`, field TEXT NULL, old_value JSONB, new_value JSONB, reason TEXT, created_at)
- [ ] Punch service (single chokepoint for all mutations; all audit rows written here):
  - [ ] `clockIn(companyId, employeeId, jobId?, source, actorUserId)` — creates work entry with new shift_id
  - [ ] `clockOut(companyId, employeeId, source, actorUserId)` — closes the open entry
  - [ ] `breakIn(companyId, employeeId, source, actorUserId)` — closes work, opens break, same shift_id
  - [ ] `breakOut(companyId, employeeId, source, actorUserId)` — closes break, opens work with same shift_id (and same job_id as pre-break work entry)
  - [ ] `switchJob(companyId, employeeId, newJobId, source, actorUserId)` — closes work on old job, opens work on new job, same shift_id
  - [ ] `editEntry(companyId, entryId, changes, actorUserId, reason)` — gated by approved status and actor role
  - [ ] `deleteEntry(companyId, entryId, actorUserId, reason)` — soft-delete via `deleted_at`; admin-only
- [ ] All mutations wrapped in DB transactions
- [ ] Concurrent punch prevention: SELECT FOR UPDATE on employee's open entry before mutation
- [ ] Auto-clock-out cron (`node-cron`, runs every 5 min): close entries where `ended_at IS NULL AND NOW() - started_at > company.auto_clockout_hours`; write audit with `is_auto_closed = true`
- [ ] Offline punch queue (frontend):
  - [ ] IndexedDB store `pending_punches` (local_id, endpoint, payload, client_started_at, retry_count)
  - [ ] Service worker intercepts punch POSTs; if offline, enqueues and returns 202 with local_id
  - [ ] Background Sync API registered on punch; flushes queue on reconnect
  - [ ] UI shows offline indicator + count of queued punches
  - [ ] Manual "sync now" button
- [ ] Offline punch acceptance (backend):
  - [ ] Endpoint accepts `client_started_at` + `client_clock_skew_ms`; server records both and stamps authoritative `started_at` = `client_started_at` adjusted by skew
  - [ ] Rejects offline punches older than 72 hours (prevents abuse) — surfaces as exception
  - [ ] Handles conflicts: if flushing creates overlapping open entries, second one rejected, surfaced on employee timesheet as exception for admin review
- [ ] Endpoints:
  - [ ] `POST /api/v1/punch/clock-in`
  - [ ] `POST /api/v1/punch/clock-out`
  - [ ] `POST /api/v1/punch/break-in`
  - [ ] `POST /api/v1/punch/break-out`
  - [ ] `POST /api/v1/punch/switch-job`
  - [ ] `GET /api/v1/punch/current` — returns employee's current open entry + today's running total
- [ ] Unit tests: every mutation path, both happy and conflict cases
- [ ] Integration tests: full shift flow — clock in → break → switch job → clock out — verify entries, shift_id consistency, audit rows
- [ ] Integration test: offline punch flushed across network restart
- [ ] Integration test: auto-clock-out cron closes stale open entry

## Phase 6 — Timesheet and approval

Goal: employees and managers see, edit, and approve timesheets. Edits always leave a trail.

- [ ] Backend: `GET /api/v1/timesheets?employee_id=&pay_period_start=&pay_period_end=` — raw entries + computed daily/weekly totals
- [ ] Backend: `GET /api/v1/timesheets/current` — current pay period for logged-in employee
- [ ] Backend: `POST /api/v1/timesheets/approve` — approve all entries in a pay period for one or more employees
- [ ] Backend: `POST /api/v1/timesheets/unapprove` — managers/admins only, writes audit
- [ ] Edit authorization matrix (enforced in punch service):
  - [ ] Employee: can edit own entries where `approved_at IS NULL`
  - [ ] Supervisor: can edit any employee's entries (approved or not) within their company scope
  - [ ] Admin: same as supervisor plus delete
  - [ ] No role can edit entries where `approved_at IS NOT NULL` and actor is the employee themselves
- [ ] Correction request flow:
  - [ ] Migration: `correction_requests` (id, company_id, time_entry_id NULL, employee_id, requester_user_id, request_type ENUM `edit`|`add`|`delete`, proposed_changes JSONB, reason, status ENUM `pending`|`approved`|`rejected`, reviewed_by NULL, reviewed_at NULL, review_note NULL, created_at)
  - [ ] `POST /api/v1/correction-requests` (employee)
  - [ ] `POST /api/v1/correction-requests/:id/approve` (manager) — applies the change via punch service
  - [ ] `POST /api/v1/correction-requests/:id/reject` (manager)
- [ ] Self-approval (internal firm mode): CompanyAdmin can approve their own pay period when `allow_self_approve = true` and company `is_internal = true`
- [ ] Supervisor-configurable approval (client-portal): company setting controls whether supervisor approval is required or whether CompanyAdmin alone can approve
- [ ] Frontend: Employee timesheet page
  - [ ] TanStack Table of entries, grouped by day, collapsible
  - [ ] Daily total + weekly running total + pay-period total
  - [ ] Hours-worked-to-date in pay period (rolling sum) shown prominently
  - [ ] Inline edit for unapproved entries; "Request correction" button for approved
  - [ ] Visual indicator: approved rows locked with a small lock icon; entries with audit history show a history icon
- [ ] Frontend: Manager timesheet review page
  - [ ] Employee selector + pay period selector
  - [ ] Same table with additional "Approve" action per employee
  - [ ] Batch approval across multiple employees
  - [ ] Exceptions panel: offline-conflict entries, auto-closed entries, missed punches, open entries older than N hours
- [ ] Frontend: Correction request inbox (manager)
- [ ] Frontend: Audit trail viewer per entry (click history icon → drawer with full audit log)
- [ ] Tests: approved entry can't be edited by employee; unapprove + re-edit flow works; correction approval produces correct audit chain

## Phase 7 — Time math (rounding, pay periods, OT)

Goal: pure, well-tested math functions that everything else depends on. Live in `shared/` so frontend and backend agree.

- [ ] `shared/time-math/` module, zero DB dependencies, 100% pure functions
- [ ] Pay period resolver:
  - [ ] `resolvePayPeriod(date, type, weekStartDay, anchorDate)` → `{ start, end }` in company timezone
  - [ ] Weekly: one week from week_start_day
  - [ ] Bi-weekly: two weeks from anchor_date (settings carries the anchor)
  - [ ] Semi-monthly: 1–15 and 16–end-of-month
  - [ ] Monthly: 1 to end of month
- [ ] Week resolver for OT:
  - [ ] `resolveWorkWeek(date, weekStartDay, tz)` → `{ start, end }` — always 7 days, independent of pay period
- [ ] Rounding engine:
  - [ ] `roundPunch(timestamp, mode, graceMinutes, direction)` — direction is `in` vs `out`
  - [ ] Modes: `none`, `1min`, `5min`, `6min` (tenths of hour), `15min`
  - [ ] Grace window: within `graceMinutes` of a rounding boundary, snap to the boundary regardless of direction
  - [ ] Rounding applied at read time only — raw punches never mutated
- [ ] OT calculation (FLSA weekly):
  - [ ] Sum rounded work-entry durations per work-week
  - [ ] Over 40 → overtime; ≤ 40 → regular
  - [ ] Edge case: week spans a pay period boundary — week totals still use full week, but pay-period report splits OT proportionally to pay period
- [ ] Daily totals per employee per day (work hours only; break hours tracked separately)
- [ ] Timesheet summary builder: `buildTimesheetSummary(entries, settings, periodStart, periodEnd)` → `{ days: [...], weekTotals: [...], periodTotal, regularHours, overtimeHours, breakHours, jobBreakdown }`
- [ ] Fuzz tests: 10,000 randomized entry sequences, verify invariants (totals non-negative, OT never exceeds total, rounding monotonic)
- [ ] Golden-file tests: specific scenarios with known outputs (pay-period-crossing week, grace window edge, midnight-crossing shift, etc.)

## Phase 8 — Reports

Goal: the five v1 reports, CSV export, and a path to PDF.

- [ ] Report engine in backend, each report is a pure function of `(companyId, params)` → tabular data
- [ ] **Time card by employee** — single employee, single pay period, entries + daily/weekly totals + regular/OT split
- [ ] **Hours by pay period** — all employees, one row each, columns: regular, OT, break, total
- [ ] **Hours by job** — all employees × all jobs for a pay period, pivot table (rows = employees, columns = jobs, cells = hours)
- [ ] **Overtime report** — employees with OT this week (including approaching OT — e.g., > 35 hrs through Thursday)
- [ ] **Audit trail report** — all audit rows for a company for a date range, filterable by actor/entry/action
- [ ] CSV export endpoint: `GET /api/v1/reports/:name.csv?params=...`
- [ ] Streaming CSV generation (no loading full result in memory)
- [ ] Frontend: report selector page; each report has its own params form; results rendered in TanStack Table with toggleable columns
- [ ] Export-to-CSV button on every report view
- [ ] PDF export: defer to Phase 13 polish, stub only
- [ ] Saved report configurations (per user, optional v1+): JSON blob of params, retrievable from a sidebar list
- [ ] Tests: each report produces correct output against a seeded dataset

## Phase 9 — Payroll exports

Goal: get approved hours out of Vibe PT and into Payroll Relief, Gusto, QBO Payroll, or generic CSV with zero manual manipulation.

- [ ] Research Payroll Relief import schema (Thomson Reuters CS Professional Suite — firm-level time import format); document in `docs/exports/payroll-relief.md`
- [ ] Research Gusto time entry CSV format; document in `docs/exports/gusto.md`
- [ ] Research QBO Payroll time-activity import format; document in `docs/exports/qbo-payroll.md`
- [ ] Migration: `payroll_exports` (id, company_id, pay_period_start, pay_period_end, format, exported_by, exported_at, file_hash, employee_count, total_hours, notes)
- [ ] Export engine: one function per format, takes `(companyId, periodStart, periodEnd)` → CSV string
- [ ] Preflight check: all timesheets in period approved; any open entries; any pending correction requests — refuses with clear error if not clean
- [ ] **Payroll Relief exporter** (rank 1)
- [ ] **Gusto exporter** (rank 2)
- [ ] **QBO Payroll exporter** (rank 3)
- [ ] **Generic CSV exporter** (rank 4) with configurable columns
- [ ] Generic CSV column mapping UI (drag-to-reorder, choose which fields to include, save as template per company)
- [ ] Re-export: warn if pay period already exported, require confirmation, log new export
- [ ] Export history page showing all past exports with download links (files stored on disk, retained per company retention setting — default 2 years)
- [ ] Tests: golden files for each format against a canonical pay period dataset

## Phase 10 — Notifications (email + Twilio SMS)

Goal: reminders land in employees' inboxes and phones without manual chasing.

- [ ] Email transport via Nodemailer; per-company SMTP config with appliance-wide fallback
- [ ] Email template system: HBS or React-email, templates live in `backend/emails/`
- [ ] Templates:
  - [ ] Password reset
  - [ ] Magic-link login
  - [ ] Missed-punch reminder
  - [ ] Timesheet approval deadline reminder
  - [ ] Correction request received (to manager)
  - [ ] Correction request decided (to employee)
  - [ ] Pay period approved (to employee)
- [ ] Twilio client with per-company credentials (decrypted at send time)
- [ ] SMS templates (short-form versions of the above)
- [ ] Notification service: `notify(companyId, type, recipient, payload)` — routes to email and/or SMS based on recipient preferences and company config
- [ ] Migration: `notifications_log` (id, company_id, recipient_type, recipient_id, channel, type, status, provider_message_id, sent_at, failed_at, error)
- [ ] Missed-punch reminder cron (every 5 min): if employee has an open entry older than `missed_punch_reminder_hours` AND no reminder sent in last 2 hours, send email + (if opted in) SMS
- [ ] Employee notification preferences: email on/off, SMS on/off, phone number verification flow
- [ ] Phone verification: SMS with 6-digit code; required before SMS opt-in becomes active
- [ ] Company-level notification overrides: admin can force-disable SMS globally, force-require email verification
- [ ] Admin view: notifications log, filterable by employee/type/status; retry-send button for failed
- [ ] Tests: templates render; Twilio errors caught and logged without crashing the cron

## Phase 11 — AI features

Goal: two AI features, both useful, neither destructive without human confirmation.

- [ ] Port LLM abstraction from Vibe TB (multi-provider: Anthropic, Ollama, OpenAI-compatible)
- [ ] Provider config per company (API keys encrypted at rest) + appliance-wide default
- [ ] Global feature flag `ai_enabled` per company; disabled by default
- [ ] **Natural-language timesheet corrections:**
  - [ ] Tool-calling schema exposing same edit/add/delete operations the manager UI uses
  - [ ] System prompt: role-scoped (employee vs manager); no access beyond employee's own timesheet for employee role
  - [ ] Request/response: NL text → tool call preview → user confirms → punch service applies → audit trail captures `edit_reason = "AI: <original NL>"`
  - [ ] Diff preview UI: before/after table, highlighted changes, explicit "Apply" / "Cancel" buttons
  - [ ] Never auto-applies; confirmation is always required
  - [ ] Rate limit: 20 NL corrections per employee per day
- [ ] **AI support chat:**
  - [ ] Bundle user-facing docs (from `docs/`) as RAG corpus; re-index on build
  - [ ] Chat UI: streaming responses, conversation history, "Ask about Vibe PT"
  - [ ] No write actions — read-only; does not have tool access to punch service
  - [ ] Guardrail: if user asks the support chat to change data, responds with "I can't change data — try the Ask assistant on your timesheet page"
- [ ] Prompt-injection hardening: strip `<system>` tags, refuse roleplay-override patterns, length caps on all free-text inputs before they enter the prompt
- [ ] Token accounting: log tokens used per request per company; surface in admin panel
- [ ] Tests: support chat refuses write intents; NL correction preview matches produced diff; disabled AI flag prevents any provider call

## Phase 12 — Licensing enforcement

Goal: commercial licensing works end-to-end, reusing the `kisaes-license-portal` Kurt already built.

- [ ] Bundle `kisaes-license-portal` RSA public key at build time
- [ ] License key format: JWT signed by portal private key; claims include `{appliance_id, company_count_cap | employee_count_cap, tier, expires_at, issued_at}`
- [ ] License storage: per-company `license_key_encrypted`, validated on load + daily
- [ ] License state machine (per company): `internal_free` | `trial` | `licensed` | `grace` | `expired`
  - [ ] `internal_free` — company marked `is_internal = true` by SuperAdmin, never needs a key
  - [ ] `trial` — 14-day trial on first client-portal company creation
  - [ ] `licensed` — valid unexpired key
  - [ ] `grace` — key expired < 60 days ago
  - [ ] `expired` — key expired ≥ 60 days ago
- [ ] Enforcement middleware: per-request check of acting company's license state
  - [ ] `internal_free` / `licensed`: full access
  - [ ] `trial`: full access, banner warning with countdown
  - [ ] `grace`: full access, prominent warning, daily email to CompanyAdmin
  - [ ] `expired`: read-only + export-only; no new punches, no edits, no approvals
- [ ] **Philosophy enforced in code:** data export is _always_ accessible regardless of license state
- [ ] **Philosophy enforced in code:** internal firm staff (users whose active company context is an internal company) are never blocked by licensing
- [ ] Daily heartbeat cron (optional per company): phones home to license portal with `{appliance_id, company_id, employee_count}`; portal returns updated license status; offline-tolerant
- [ ] License upload UI for CompanyAdmin: paste JWT, validate, display parsed claims
- [ ] SuperAdmin UI: all companies with license states, expiration dates, flag-internal toggle
- [ ] Frontend: banners for trial/grace/expired states with CTA to licensing.kisaes.com
- [ ] Integration test: expired company can still export CSV but cannot create a punch

## Phase 13 — Polish, documentation, release

Goal: the appliance is shippable, defensible in a CPA firm's vendor review, and installable by a non-developer.

- [ ] Four-level backup (same pattern as Vibe TB):
  - [ ] Level 1: continuous WAL archiving (Postgres built-in)
  - [ ] Level 2: nightly pg_dump to local disk (rotated 14 days)
  - [ ] Level 3: weekly compressed backup to configurable S3-compatible destination (BYO bucket + creds)
  - [ ] Level 4: on-demand "export everything" — single ZIP containing schema dump + data dump + uploaded files + encrypted secrets reference
- [ ] Restore tooling + restore drill documented
- [ ] `docs/` tree:
  - [ ] `deployment.md` — NucBox M6 install walkthrough, Cloudflare Tunnel setup, Tailscale Funnel setup
  - [ ] `admin-guide.md` — SuperAdmin and CompanyAdmin workflows with screenshots
  - [ ] `employee-guide.md` — PIN punch, personal-device punch, correction requests
  - [ ] `kiosk-setup.md` — tablet pairing, mounting recommendations, hardening (kiosk-mode browser)
  - [ ] `integrations.md` — Twilio setup, SMTP setup, Payroll Relief/Gusto/QBO export specifics
  - [ ] `security.md` — at-rest encryption, JWT strategy, backup encryption, data retention
  - [ ] `troubleshooting.md` — common issues + fixes
- [ ] PDF export of reports (defer stub from Phase 8): Puppeteer-based, using same table templates as on-screen
- [ ] Data retention policies (per company): auto-delete audit rows, notifications log, export files older than X years (default 7 years for audit, 2 for logs/exports)
- [ ] SuperAdmin dashboard: appliance health (DB size, backup status, tunnel status, cron last-run times, notification success rate)
- [ ] Landing page: Cloudflare Pages static site at vibepayrolltime.com with product positioning, features, pricing, demo request (same pattern as Vibe TB)
- [ ] Demo appliance: canned multi-tenant setup on a cloud VM for prospects to click through
- [ ] Marketing collateral: feature comparison vs QB Time / OnTheClock / Homebase, CPA-firm positioning one-pager
- [ ] SEO + GEO: sitemap, structured data, llms.txt, topical authority pieces on "time tracking for CPA firms", "self-hosted time tracking", "FLSA overtime compliance"
- [ ] Load test: simulate 500 employees punching within a 30-min window; verify no open-entry conflicts, no audit gaps
- [ ] Security review checklist: OWASP Top 10 pass, dependency audit, secret-scanning, `npm audit` clean
- [ ] Final CLAUDE.md refresh to reflect any architectural decisions made during build
- [ ] Tag v1.0.0, write release notes, announce

---

## Running counts

- Phases: 14 (0–13)
- Checklist items: ~270 (significantly lighter than Vibe TB's 898 because no scheduling, no PTO, no payroll processing, no GPS, no state-specific compliance)
- Expected phase durations assume a single focused developer using Claude Code with `CLAUDE.md` context; your mileage may vary
