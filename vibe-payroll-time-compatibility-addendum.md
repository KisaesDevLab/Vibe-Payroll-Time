# Vibe-Payroll-Time — Appliance Compatibility Addendum

Companion to `docs/PLAN.md` (the Vibe-Appliance plan) and to `vibe-appliance-emergency-access-addendum.md`. This document specifies the changes needed in `KisaesDevLab/Vibe-Payroll-Time` so that a single set of GHCR images runs cleanly in two deployment modes:

- **Standalone:** customer runs the app's `scripts/install.sh`; bundled Postgres + Redis + workers; multi-tenant by default (one instance can host multiple firms); current behavior, must not regress.
- **Appliance:** the Vibe-Appliance composes Vibe-Payroll-Time alongside other Vibe apps; shared Postgres + Redis; single-tenant (one firm per appliance); behind Caddy at `time.<domain>` with three documented access methods.

Payroll-Time differs from other Vibe apps in three ways that this addendum spends most of its weight on: a wall-mounted **kiosk audience** (PIN/QR auth on shared tablets), a real **PWA** with service workers and offline support, and a **multi-tenant mode** that needs to collapse to single-tenant in appliance deployment.

---

## 1. Design principles

Same three rules as the MyBooks addendum, repeated for clarity. If a future change violates one, push back on the change.

1. **Standalone behavior must not change for existing customers.** Customers running the standalone install today should see identical setup, identical defaults, identical kiosk and employee flows after this work ships. All new behavior is opt-in via env vars.
2. **One image, two modes.** Same `ghcr.io/kisaesdevlab/vibe-payroll-time-*` images run both standalone and appliance. The deployment harness differs (which compose file, which env values), not the image.
3. **Configuration over forks.** Every behavioral difference between modes is expressed as an env var or compose overlay. No build-time flags, no separate Dockerfiles.

---

## 2. Audit summary

| Item                                 | Today                                                                       | Target                                                               | Notes                                       |
| ------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | ---- |
| Stack                                | React 18 + Node 20 + Express + PG16 + Redis 7 + BullMQ + service-worker PWA | Same                                                                 | No stack changes                            |
| License                              | ELv2 (verify)                                                               | ELv2                                                                 | Audit                                       |
| Standalone install                   | `scripts/install.sh`                                                        | Unchanged                                                            | Must keep working                           |
| GHCR images                          | Need verification                                                           | Multi-arch (amd64 + arm64), tags `latest` / `vN.M.K` / `sha-<short>` | §5.1 (common)                               |
| DB / Redis config                    | Mixed assumed                                                               | `DATABASE_URL` / `REDIS_URL` only                                    | §5.1 (common)                               |
| `ALLOWED_ORIGIN`                     | Likely single-value                                                         | Comma-separated list with regex support                              | §5.1 (common)                               |
| Migrations                           | Auto on startup                                                             | Gated by `MIGRATIONS_AUTO` (default `true`)                          | §5.1 (common)                               |
| `/health` + `/ping`                  | Need verification                                                           | `/health` checks deps; `/ping` cheap liveness                        | §5.1 (common)                               |
| Workers                              | BullMQ for OT calc, exports, AI corrections                                 | Env-driven, heartbeat to Redis                                       | §5.1 (common)                               |
| Logs                                 | Mixed                                                                       | Stdout/stderr structured JSON in production                          | §5.1 (common)                               |
| PWA service worker                   | Single SW for whole app                                                     | Audience-aware caching + version-pinned for kiosk                    | §5.2                                        |
| Kiosk auth                           | PIN + QR badge                                                              | Kept; URL must be stable across primary/Tailscale                    | §5.3                                        |
| Kiosk URL stability                  | Likely tied to current domain                                               | Per-kiosk QR with embedded URL hint, fallback URL list               | §5.3                                        |
| Multi-tenant                         | Multi-firm by default                                                       | `TENANT_MODE=single                                                  | multi`env var;`single` is appliance default | §5.4 |
| AI corrections                       | LLM endpoint configurable?                                                  | `LLM_ENDPOINT` env, optional, graceful disable when missing          | §5.5                                        |
| SMS abstraction                      | Twilio + TextLink                                                           | Same envs as Connect; TextLink default in appliance                  | §5.6                                        |
| Time zone handling                   | Likely host TZ                                                              | Explicit `TZ` env + per-firm DB-stored TZ + per-employee             | §5.7                                        |
| FLSA workweek start                  | Likely hardcoded Sunday                                                     | Configurable per-firm in DB                                          | §5.7                                        |
| `PUBLIC_URL` for exports/magic-links | Likely uses `ALLOWED_ORIGIN`                                                | Dedicated `PUBLIC_URL` env var                                       | §5.1 (common)                               |
| Compose files                        | `docker-compose.yml`                                                        | Add `docker-compose.appliance.yml`                                   | §5.9                                        |
| Manifest                             | None                                                                        | `.appliance/manifest.json` with `emergencyPort: 5192`                | §5.10                                       |
| Volumes                              | Bundled                                                                     | Bundled in standalone; named-volume references in appliance          | §5.8                                        |
| Emergency-access compatibility       | Likely fails (HTTPS-redirect, Secure cookies, SW behavior)                  | Audited and conformant                                               | §5.11                                       |

---

## 3. Common-requirements pass

Items 1–10 of PLAN.md §8.1 apply to Vibe-Payroll-Time without per-app variation. The MyBooks addendum spells these out in detail (§3.1–3.7, 3.9, 3.12 there). Same audits apply here:

- Multi-arch GHCR with `latest` / `vN.M.K` / `sha-<short>` tags and OpenContainers labels.
- `DATABASE_URL` and `REDIS_URL` as the single source of DB/Redis config (deprecate parallel `DB_HOST`, `REDIS_HOST`, etc.).
- `ALLOWED_ORIGIN` accepts comma-separated list with regex entries.
- `MIGRATIONS_AUTO` env var (default `true`).
- `/api/v1/health` and `/api/v1/ping` distinction: ping is liveness, health is readiness with per-dependency status.
- BullMQ workers fully env-driven with heartbeats readable by `/health`.
- `PUBLIC_URL` env var for any URL embedded in email/SMS/exports.
- Structured stdout logging via pino.
- No PII in logs, ever.

These are mechanical — same rationale and tests as MyBooks. Sections 5.x below are Payroll-Time-specific changes that don't appear elsewhere.

---

## 4. Access methods × audiences

Payroll-Time has three audiences (manager, employee, kiosk) and the appliance offers three access methods (primary domain, Tailscale, emergency). Not all combinations work — kiosk + emergency is genuinely broken by web-platform constraints. This matrix is the canonical reference.

|                                                      | Primary domain<br>(`https://time.firm.com`) | Tailscale<br>(`https://time.<tailnet>.ts.net`) | Emergency<br>(`http://<ip>:5192`) |
| ---------------------------------------------------- | ------------------------------------------- | ---------------------------------------------- | --------------------------------- |
| **Manager** (admin UI, schedules, exports, reports)  | ✅ Full                                     | ✅ Full                                        | ✅ Staff emergency only           |
| **Employee** (self-service, view hours, request PTO) | ✅ Full                                     | ✅ Full                                        | ✅ Staff emergency only           |
| **Kiosk** (wall-mounted tablet, PIN/QR punch)        | ✅ Full PWA                                 | ✅ Full PWA                                    | ❌ **Does not work** — see below  |

### 4.1 Why kiosk + emergency is broken

Modern browsers refuse to register service workers over plain HTTP. The PWA's offline-first design — punch in/out queues to localStorage when wifi is shaky, syncs when connectivity returns — depends on the service worker. Without it, a tablet on the emergency URL becomes a thin client that fails on every network blip.

Worse, even if you accept the lost offline support, browsers won't _upgrade_ an existing PWA installation to point at a new origin. The tablet has `https://time.firm.com` installed as a PWA; pointing it at `http://192.168.1.50:5192` requires uninstalling the PWA, opening the new URL in the browser, and the service worker still won't activate because it's HTTP.

**Conclusion: kiosk tablets must always use Primary or Tailscale. Plan for kiosk URLs to be stable.** Emergency mode is for staff laptops and desktops only.

### 4.2 Recommended kiosk URL strategy

The kiosk URL on a wall-mounted tablet is bookmarked once and rarely touched. It needs to survive:

- Customer rebranding their domain (rare, but happens).
- Caddy / cert problems (frequent enough to plan for).
- A new server replacing the old one (every few years).

Three options, in order of recommendation:

1. **Tailscale URL on the kiosk tablet.** The tablet joins the tailnet (free Tailscale plan supports up to 100 devices on a personal account, more on Business). URL becomes `https://time.<tailnet>.ts.net/kiosk?location=<id>`. Survives DNS changes, doesn't depend on Caddy, HTTPS works (Tailscale CA), service workers register normally. **Recommended default for any kiosk.**
2. **Primary domain with DHCP reservation for the server.** Tablet uses `https://time.firm.com/kiosk?...`. Customer's router gives the appliance a static internal IP; customer's DNS or `/etc/hosts` on the tablet (Android allows this with effort) resolves the domain to the LAN IP for kiosk traffic. Survives ISP outages but requires DNS work the customer probably won't do.
3. **mDNS via Avahi on the appliance.** Tablet uses `https://time.appliance.local/kiosk?...`. Browsers on Android handle mDNS inconsistently; iOS handles it well. Don't recommend as primary.

### 4.3 Tablet "fallback URL list" feature

Worth considering as a v1.1 feature, not v1: the kiosk PWA on first load fetches a list of fallback URLs from the server (`/api/v1/kiosk/access-points`) and stores them. If the primary becomes unreachable, the PWA's offline shell shows a "Switch access point" button that lets the on-site person pick an alternate URL (e.g., the Tailscale one). The QR badge encodes the employee ID, not a URL, so the auth still works once the right access point is reached.

This is the right answer to "kiosk works through outages" but it requires real PWA work. Defer to v1.1 unless customers demand it. Document the manual-bookmark-change procedure as the v1 answer.

### 4.4 Manager and employee audiences

Both manager and employee audiences work cleanly in all three access methods. Subtleties:

- **Magic-link emails** (e.g., a manager's password reset, an employee's PTO request approval) embed `PUBLIC_URL` (per §5.1 / common requirements). They always point at the primary domain. A manager who clicks a link from email while on Tailscale will get an error — link goes to the public domain; manager's browser tries to fetch over the public path. Not a Payroll-Time bug; document this as a known UX wrinkle.
- **Emergency mode for managers/employees** works for the basic web flows but doesn't work for in-app actions that POST to integrations (Twilio webhook callbacks, ADP export confirmations) because those callback URLs are signed against the primary domain. Document: "Use emergency access for time-card review and manual entry only. Run integrations from primary."

---

## 5. Payroll-Time-specific changes

### 5.1 Common requirements (referenced — see §3)

All ten common items audited and brought to spec. No app-specific deviations.

### 5.2 PWA service worker behavior

**Goal.** Service worker must be production-stable across primary and Tailscale access methods, must version cleanly across app updates, and must not aggressively cache the kiosk's schedule or roster data (employees can't punch in if their account isn't in the cached roster).

**Action — five items:**

1. **Audit the service worker scope and registration.** Single SW at `/sw.js` covering the whole app. Scope `/`. Registered in `main.tsx` after the React app mounts.
2. **Version the SW with the app's build SHA.** Cache name: `payroll-time-v<build-sha>`. New SW activates on next page load; old caches are purged. This avoids the "stuck on stale assets after update" PWA pain.
3. **Cache strategy by route family:**
   - **App shell** (`/`, `/employee`, `/admin`, `/kiosk`, JS/CSS bundles): cache-first, stale-while-revalidate. Fast loads, picks up updates within a session.
   - **Roster / schedule data** (`/api/v1/kiosk/roster`, `/api/v1/employee/schedule`): network-first with 30-second cache fallback. Kiosk needs the freshest roster, but a 30-second blip shouldn't break punch-in.
   - **Punch submissions** (`POST /api/v1/punch`): network-only. If offline, queue in IndexedDB and replay when online (existing offline-first design).
   - **Static assets** (logo, icons, fonts): cache-first, long-lived.
4. **Cross-origin isolation.** Service worker only handles requests to its own origin. If the customer migrates from primary domain to Tailscale URL, the SW on the new origin is a fresh install — no stale cache from the old origin. This is correct browser behavior, not something to override.
5. **Service worker registration must NOT happen over HTTP.** Already enforced by browsers, but the app should detect HTTP and show a "PWA features unavailable on emergency access" banner instead of a silent broken SW.

**Tests.**

- Build a tagged release. Install PWA on Android tablet. Push a new release. Reload. SW updates within one cycle, old cache purged.
- Disconnect tablet wifi mid-shift. Submit 3 punches. Reconnect. All 3 sync within 30 seconds.
- Open kiosk URL over HTTP (emergency port from a LAN client). Banner appears: "Emergency access mode — PWA features disabled."
- Cache scope: confirm SW does not cache cross-origin requests (e.g., to Twilio, to the LLM endpoint).

**Standalone impact.** None — service worker behavior is identical across deployment modes. The improvements (version-pinned cache, route-family strategy) help standalone too.

### 5.3 Kiosk auth and URL stability

**Goal.** Kiosk tablets work reliably for years without re-configuration. PIN and QR auth flows stay clean across access methods.

**Action.**

- **Kiosk URL format.** `<base>/kiosk?location=<location-id>`. The `location` query parameter encodes which physical kiosk this is — used for "Punch from approved location only" enforcement and audit logs. Document that this URL is _stable for the life of the appliance_ — never include domain-specific or environment-specific tokens in it.
- **PIN auth.** Employee enters 4-6 digit PIN. PIN is per-employee, set in admin UI. PIN is hashed server-side; never stored plaintext. Already correct; audit confirms.
- **QR badge auth.** QR encodes a _signed employee token_, not a URL. Format: a JWT signed with a kiosk-shared secret containing `{employeeId, firmId, expiresAt}`. Tablet camera reads QR, sends token to server, server verifies signature and signs the employee in. QR badges can be printed once and used for years (until the employee leaves the firm).
- **Token rotation.** Admin UI has a "Reissue all QR badges" button that rotates the kiosk-shared secret and invalidates all outstanding badges. Used when an employee leaves with their badge or a badge is suspected stolen.
- **Kiosk session lifetime.** Kiosk doesn't have a "logged in" state — every interaction starts with PIN or QR. After punch is submitted and confirmed, kiosk returns to the auth screen within 5 seconds (configurable as `KIOSK_AUTO_LOGOUT_MS`).

**Tests.**

- Issue QR badge for employee. Print. Scan from kiosk tablet. Punch in. Punch out 8 hours later. Both punches recorded with correct location.
- Reissue all badges. Old QR no longer authenticates.
- PIN entry on shared tablet — 5 different employees punch in/out within 60 seconds, no session bleed between them.

**Standalone impact.** None — kiosk auth is the same across deployment modes.

### 5.4 Multi-tenant → single-tenant in appliance

**Goal.** Standalone supports multiple firms on one Payroll-Time instance (today's behavior). Appliance auto-bootstraps a single firm and hides multi-tenant UI affordances.

**Action.**

- New env var `TENANT_MODE` with values `multi` (default) and `single`.
- In `single` mode:
  - On first boot, if no firms exist in DB, auto-create a default firm using `FIRM_NAME` env var (set by appliance bootstrap from customer-provided value, or `Default Firm` if not provided).
  - Hide "Switch firm" UI affordances. Routes that take `firmId` parameters resolve to the single firm automatically.
  - First registered user becomes the firm admin. Subsequent registrations are employees of that firm. The "create new firm" flow is hidden.
  - Admin "manage firms" page hidden.
- In `multi` mode (standalone default): current behavior unchanged. The "create new firm" flow is visible. Switching between firms is supported.
- Schema is unchanged. `firms` table still has the `id` column; appliance just always operates on a single row.

**Tests.**

- Standalone with `TENANT_MODE=multi`: create two firms, employees of each, verify isolation. Current behavior.
- Appliance with `TENANT_MODE=single` and `FIRM_NAME=Acme Tax`: first boot creates "Acme Tax" firm, admin UI doesn't show firm picker, registration adds users to that firm.
- `TENANT_MODE=single` with existing multi-firm DB: refuse to start, log a clear error ("Multi-firm DB cannot run in single-tenant mode; export and restore one firm").

**Standalone impact.** Existing standalone customers default to `multi` and see no change.

### 5.5 AI endpoint configurability

**Goal.** AI natural-language timesheet correction features (e.g., "I forgot to punch out Tuesday — fix it") use an LLM endpoint that's configurable, optional, and gracefully degrades when missing.

**Action.**

- New env vars:
  - `LLM_ENDPOINT` — URL of OpenAI-compatible chat-completions endpoint. Optional. If empty, AI features are disabled.
  - `LLM_API_KEY` — API key. Optional. Empty for endpoints that don't require auth (e.g., local Ollama).
  - `LLM_MODEL` — model name. Default: `qwen3-8b-instruct` for self-hosted; required if `LLM_ENDPOINT` is set.
- Manifest declares `optionalDepends: ["vibe-glm-ocr"]`. In appliance mode, if Vibe-GLM-OCR is also enabled, `LLM_ENDPOINT` defaults to `http://vibe-glm-ocr:11434/v1` (Ollama's OpenAI-compatible API). Customer doesn't have to configure manually.
- If `LLM_ENDPOINT` is unset or unreachable, the AI-corrections UI is hidden. No errors, no broken affordances; the feature simply doesn't appear.
- Health endpoint reports LLM status separately from required dependencies. Health stays green even if LLM is down — AI is non-essential.

**Tests.**

- `LLM_ENDPOINT` unset: AI corrections UI hidden everywhere. App fully functional.
- `LLM_ENDPOINT=http://vibe-glm-ocr:11434/v1` with GLM-OCR running: AI corrections work. Test sample request returns coherent response.
- LLM endpoint reachable but model not loaded: AI request returns user-friendly error, doesn't crash.
- Appliance with both Payroll-Time and Vibe-GLM-OCR enabled: Payroll-Time auto-discovers GLM-OCR via the appliance's service-discovery (env injection); no manual config required.

**Standalone impact.** Standalone customers who don't configure `LLM_ENDPOINT` see today's behavior (likely AI features hidden or pointing to a default that's no longer used). Standalone customers who do configure it gain the same flexibility.

### 5.6 SMS provider abstraction

**Goal.** Same provider abstraction as Vibe-Connect — Twilio and TextLink interchangeable via env config.

**Action.**

- New env vars:
  - `SMS_PROVIDER` — `twilio` | `textlink` | `none`. Default `none`.
  - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` — required if provider is `twilio`.
  - `TEXTLINK_API_URL`, `TEXTLINK_API_KEY` — required if provider is `textlink`.
- Internal SMS interface: a single `sendSms(to, body, opts)` function that dispatches to the configured provider. App code never imports Twilio or TextLink SDKs directly.
- If `SMS_PROVIDER=none`: SMS-dependent flows (PTO request notifications, schedule change alerts, late-punch reminders) silently skip. UI shows "(SMS disabled)" badge in the relevant settings.

**Tests.**

- Each provider: send a test SMS via the admin UI, verify delivery.
- `SMS_PROVIDER=none`: PTO request approved → email sent, SMS skipped, no errors.
- Provider misconfigured (bad credentials): error logged, request fails gracefully, customer sees actionable error in admin.

**Standalone impact.** Existing customers with `SMS_PROVIDER=twilio` are unaffected. New `textlink` option is additive.

### 5.7 Time zone and FLSA workweek configuration

**Goal.** Time tracking is brutally TZ-sensitive. Wrong TZ math produces wrong overtime calculations, which produces wrong paychecks. This must be explicit and auditable.

**Action.**

- **Three TZ layers, in order of precedence:**
  1. **Per-employee TZ** (DB column on `employees`). For multi-state firms with remote employees in different zones. Default: per-firm TZ.
  2. **Per-firm TZ** (DB column on `firms`). Set during firm bootstrap, editable in admin UI. Default: host TZ.
  3. **Host TZ** (`TZ` env var, propagated by Docker from host). Default: `America/Chicago` (Kurt's locale; document and let appliance customize).
- All time calculations use the most-specific applicable TZ layer.
- Display layer: employee-facing UI shows times in their TZ; admin UI shows times in firm TZ with employee-TZ note when relevant; exports use a configurable TZ per export.
- **FLSA workweek start day.** Per-firm config (DB column `workweek_start_day`, 0=Sunday … 6=Saturday). Default: Sunday. Configurable in admin UI at firm bootstrap; warn loudly before changing once data exists.
- **OT calculation honors the configured workweek.** Audit: existing OT logic must not assume Sunday start. Test: punch a Saturday-Sunday shift in a firm with Monday workweek start; OT calc must align.
- DST handling: punches store UTC timestamps in DB (no ambiguity); display layer converts to TZ. "Spring forward" Sundays don't lose punches; "fall back" Sundays don't double-count hours. Test explicitly with synthetic punches across DST boundaries.

**Tests.**

- Employee in `America/New_York`, firm in `America/Chicago`: punch shows correct local time in both views.
- Firm with `workweek_start_day=Monday`: 50-hour week starting Sunday counts only Sunday's hours toward last week's OT; Monday's onward count toward this week.
- Synthetic punches at 2025-03-09 01:30 and 2025-03-09 03:30 (US DST spring-forward, 2:00–3:00 doesn't exist): hours diff is 1.0, not 2.0.
- Synthetic punches at 2025-11-02 01:30 and 2025-11-02 01:30+1hr (US DST fall-back, 1:00–2:00 happens twice): hours diff is 1.0, recorded as one continuous punch.

**Standalone impact.** Existing customers see no change unless their multi-state employees have been manually configured. The per-employee TZ is additive.

### 5.8 Volume strategy

**Goal.** Standalone uses bundled volumes (today's behavior). Appliance uses externally named volumes the appliance backs up via Duplicati.

**Action.**

- Volumes:
  - `vibe-payroll-time-uploads`: employee documents, PTO request attachments, photo punches if enabled.
  - `vibe-payroll-time-exports`: generated payroll export files (ADP, QBO, Paychex, Square). Retained for 90 days then auto-pruned.
  - `vibe-payroll-time-reports`: PDF reports generated for customer download.
- Standalone `docker-compose.yml`: volumes declared with default driver, project-scoped.
- Appliance `docker-compose.appliance.yml`: same volume names with `vibe-` prefix already in place; appliance compose maps them to bind paths under `/opt/vibe/data/apps/vibe-payroll-time/` for Duplicati visibility.
- App code must not write non-ephemeral data to non-volume paths.

**Tests.**

- Standalone: uploads survive `docker compose down && up`.
- Appliance: upload a document, find it under `/opt/vibe/data/apps/vibe-payroll-time/uploads/`. Duplicati's default backup source picks it up.

### 5.9 `docker-compose.appliance.yml`

```yaml
# docker-compose.appliance.yml
# Appliance overlay for Vibe-Payroll-Time. Used by Vibe-Appliance.
# Standalone deployments should use docker-compose.yml instead.

services:
  vibe-payroll-server:
    image: ghcr.io/kisaesdevlab/vibe-payroll-time-server:${VIBE_PAYROLL_TAG:-latest}
    networks: [vibe_net]
    environment:
      DATABASE_URL: ${VIBE_PAYROLL_DATABASE_URL}
      REDIS_URL: ${VIBE_PAYROLL_REDIS_URL}
      ALLOWED_ORIGIN: ${VIBE_PAYROLL_ALLOWED_ORIGIN}
      PUBLIC_URL: ${VIBE_PAYROLL_PUBLIC_URL}
      JWT_SECRET: ${VIBE_PAYROLL_JWT_SECRET}
      ENCRYPTION_KEY: ${VIBE_PAYROLL_ENCRYPTION_KEY}
      KIOSK_SHARED_SECRET: ${VIBE_PAYROLL_KIOSK_SECRET}
      TENANT_MODE: 'single'
      FIRM_NAME: ${VIBE_PAYROLL_FIRM_NAME:-Default Firm}
      TZ: ${VIBE_PAYROLL_TZ:-America/Chicago}
      MIGRATIONS_AUTO: 'false'
      LOG_LEVEL: ${VIBE_PAYROLL_LOG_LEVEL:-info}
      SMS_PROVIDER: ${VIBE_PAYROLL_SMS_PROVIDER:-none}
      LLM_ENDPOINT: ${VIBE_PAYROLL_LLM_ENDPOINT:-}
      LLM_API_KEY: ${VIBE_PAYROLL_LLM_API_KEY:-}
      LLM_MODEL: ${VIBE_PAYROLL_LLM_MODEL:-qwen3-8b-instruct}
    volumes:
      - vibe-payroll-time-uploads:/app/uploads
      - vibe-payroll-time-exports:/app/exports
      - vibe-payroll-time-reports:/app/reports
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/api/v1/ping']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  vibe-payroll-worker:
    image: ghcr.io/kisaesdevlab/vibe-payroll-time-server:${VIBE_PAYROLL_TAG:-latest}
    command: ['node', 'dist/worker.js']
    networks: [vibe_net]
    environment:
      DATABASE_URL: ${VIBE_PAYROLL_DATABASE_URL}
      REDIS_URL: ${VIBE_PAYROLL_REDIS_URL}
      WORKER_CONCURRENCY: '2'
      TZ: ${VIBE_PAYROLL_TZ:-America/Chicago}
      LOG_LEVEL: ${VIBE_PAYROLL_LOG_LEVEL:-info}
    restart: unless-stopped
    depends_on: [vibe-payroll-server]

  vibe-payroll-client:
    image: ghcr.io/kisaesdevlab/vibe-payroll-time-client:${VIBE_PAYROLL_TAG:-latest}
    networks: [vibe_net]
    restart: unless-stopped
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:80/']
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  vibe_net:
    external: true

volumes:
  vibe-payroll-time-uploads:
  vibe-payroll-time-exports:
  vibe-payroll-time-reports:
```

### 5.10 `.appliance/manifest.json`

```json
{
  "schemaVersion": 1,
  "slug": "vibe-payroll-time",
  "displayName": "Vibe Payroll Time",
  "description": "Employee time tracking with kiosk, PIN/QR auth, and payroll export",
  "logo": "payroll-time.svg",
  "userFacing": true,
  "image": {
    "server": "ghcr.io/kisaesdevlab/vibe-payroll-time-server",
    "client": "ghcr.io/kisaesdevlab/vibe-payroll-time-client",
    "defaultTag": "latest"
  },
  "ports": { "server": 3000, "client": 80 },
  "subdomains": [
    {
      "name": "time",
      "target": "vibe-payroll-client:80",
      "audience": "default",
      "emergencyPort": 5192,
      "emergencyNote": "Staff-only emergency access. Kiosk mode does NOT work over emergency access — service workers require HTTPS. Wall-mounted kiosks must use the primary domain or Tailscale."
    }
  ],
  "depends": ["postgres", "redis"],
  "optionalDepends": ["vibe-glm-ocr"],
  "publicUrlEnvVar": "PUBLIC_URL",
  "websocket": false,
  "env": {
    "required": [
      { "name": "JWT_SECRET", "generate": "hex32" },
      { "name": "ENCRYPTION_KEY", "generate": "hex32" },
      { "name": "KIOSK_SHARED_SECRET", "generate": "hex32" },
      {
        "name": "DATABASE_URL",
        "from": "shared-postgres-url",
        "database": "vibe_payroll_time_db",
        "user": "vibepayroll"
      },
      { "name": "REDIS_URL", "from": "shared-redis-url", "namespace": "payroll" },
      { "name": "ALLOWED_ORIGIN", "from": "subdomain-url" },
      { "name": "PUBLIC_URL", "from": "subdomain-url" },
      { "name": "TZ", "default": "America/Chicago", "doc": "Host time zone (IANA name)" },
      { "name": "TENANT_MODE", "default": "single", "doc": "Always single in appliance mode" },
      { "name": "FIRM_NAME", "from": "customer-prompt", "default": "Default Firm" }
    ],
    "optional": [
      { "name": "SMS_PROVIDER", "default": "none", "doc": "twilio | textlink | none" },
      { "name": "TWILIO_ACCOUNT_SID", "secret": true },
      { "name": "TWILIO_AUTH_TOKEN", "secret": true },
      { "name": "TWILIO_FROM_NUMBER", "secret": false },
      { "name": "TEXTLINK_API_URL", "secret": false },
      { "name": "TEXTLINK_API_KEY", "secret": true },
      {
        "name": "LLM_ENDPOINT",
        "doc": "OpenAI-compatible endpoint URL; auto-detected if Vibe-GLM-OCR is enabled"
      },
      { "name": "LLM_API_KEY", "secret": true },
      { "name": "LLM_MODEL", "default": "qwen3-8b-instruct" },
      { "name": "WORKER_CONCURRENCY", "default": "2" },
      { "name": "LOG_LEVEL", "default": "info" }
    ]
  },
  "database": { "name": "vibe_payroll_time_db", "user": "vibepayroll" },
  "firstLogin": {
    "type": "self-register-first-user-becomes-admin",
    "url": "/register",
    "note": "First registered user becomes the firm admin. Set up employees from the admin console."
  },
  "health": "/api/v1/health",
  "ping": "/api/v1/ping",
  "migrations": {
    "command": ["node", "dist/migrate.js"],
    "autoEnvVar": "MIGRATIONS_AUTO"
  },
  "backup": {
    "volumes": [
      "vibe-payroll-time-uploads",
      "vibe-payroll-time-exports",
      "vibe-payroll-time-reports"
    ],
    "databases": ["vibe_payroll_time_db"]
  },
  "kiosk": {
    "supported": true,
    "stableUrlGuidance": "Wall-mounted kiosks must use the primary domain or Tailscale URL. Document the chosen URL in CREDENTIALS.txt under 'Kiosk URL' for the customer's records."
  }
}
```

The `kiosk` block is a Payroll-Time-specific manifest extension. The console reads it and surfaces the kiosk URL in the admin "Apps" panel with a copy button labeled "Kiosk URL (use for tablets)."

### 5.11 Emergency-access compatibility

**Goal.** When accessed via the appliance's emergency proxy at `http://<server-ip>:5192`, the manager and employee web UIs must work for staff to do their jobs. Kiosk mode is explicitly broken on this path (per §4.1) and the app must communicate that clearly.

**Action.**

1. **Disable HTTPS-redirect inside the app.** Same as MyBooks §3.14.1. Audit middleware.
2. **No `X-Forwarded-Proto: https` requirement.** Same as MyBooks §3.14.2.
3. **Host header allowlist tolerates IP:port form.** Same as MyBooks §3.14.3.
4. **Cookies use `secure: 'auto'`.** Same as MyBooks §3.14.4. _Especially_ important here because employees punch in/out frequently — broken cookies mean re-login every action.
5. **`/api/v1/ping` works without DB or Redis.** Same as MyBooks §3.14.5.
6. **Detect HTTP origin, hide kiosk affordance.** When the app is loaded over HTTP (i.e., emergency mode), the kiosk-mode entry point at `/kiosk` displays a clear "Kiosk mode requires secure access. Switch to https://time.firm.com or your Tailscale URL." page instead of attempting to render the kiosk UI.
7. **Detect HTTP origin, hide PWA install prompt.** No "Install app" banner over emergency mode — would silently fail.

**Tests.**

- Kill Caddy, hit `http://<lan-ip>:5192/`. Manager logs in, views timesheet, runs a report. Works.
- Hit `http://<lan-ip>:5192/kiosk?location=1`. Returns the explanatory page, not the kiosk UI.
- Cookie inspection on emergency URL: session cookie set without `Secure` flag, persists across requests.
- `/api/v1/ping` returns 200 with Postgres stopped (HAProxy uses this for backend health).

**Standalone impact.** Items 1–5 make standalone behavior more correct (any standalone running plain HTTP behind an external proxy benefits). Items 6–7 are no-ops in standalone over HTTPS (the conditional doesn't trigger).

---

## 6. PR plan

Three PRs against `KisaesDevLab/Vibe-Payroll-Time`, in order. Each is independently mergeable.

### PR 1: Common requirements + structured logging (sections 5.1)

- Multi-arch GHCR.
- `DATABASE_URL` / `REDIS_URL` consolidation.
- `ALLOWED_ORIGIN` list.
- `MIGRATIONS_AUTO`.
- `/health` and `/ping`.
- BullMQ workers env-driven with heartbeats.
- `PUBLIC_URL`.
- Structured stdout logging.

### PR 2: Multi-tenant mode + TZ/FLSA + AI/SMS (sections 5.4, 5.5, 5.6, 5.7)

The behavior-changing PR. Higher review weight.

- `TENANT_MODE` env var with single-firm bootstrap.
- Per-employee/per-firm TZ layers.
- Configurable FLSA workweek start.
- DST regression tests added.
- `LLM_ENDPOINT` / `LLM_API_KEY` / `LLM_MODEL` plumbing with auto-discovery.
- `SMS_PROVIDER` abstraction with Twilio + TextLink.

### PR 3: Appliance overlay + manifest + emergency + PWA (sections 5.2, 5.3, 5.8, 5.9, 5.10, 5.11)

The "make it appliance-ready" PR.

- `docker-compose.appliance.yml`.
- `.appliance/manifest.json` with `emergencyPort: 5192` and kiosk block.
- Volume strategy.
- Service-worker versioning + cache strategy.
- Kiosk URL stability documentation in README.
- Emergency-access compatibility audits and fixes.
- Kiosk-disabled-over-HTTP detection page.

After PR 3 merges and a tagged image publishes, the Vibe-Appliance Phase 5 work for Vibe-Payroll-Time becomes:

1. Drop `apps/vibe-payroll-time.yml` overlay in the appliance repo.
2. Drop `env-templates/per-app/vibe-payroll-time.env.tmpl`.
3. Document the recommended kiosk URL strategy (Tailscale-first) in the appliance install guide.
4. Test toggle on/off, kiosk via primary, kiosk via Tailscale, manager via emergency on a fresh droplet.

---

## 7. Backward compatibility commitments

Things that must not change for existing standalone customers:

- `scripts/install.sh` produces a working install on a fresh Ubuntu host with no env-var changes required.
- An existing customer's `.env` file continues to work after upgrade. Deprecated vars produce a single `[deprecated]` log line and synthesize the new vars internally.
- Default `TENANT_MODE=multi` for standalone — multi-firm setups still work.
- Default port mappings unchanged.
- Existing kiosk URLs (whatever the customer bookmarked) continue to work.
- PWA service worker upgrade path: existing installations transition to versioned cache cleanly without manual uninstall.
- Existing FLSA OT calculations produce identical results for firms that don't change their workweek start day.
- Existing TZ behavior for single-TZ firms is bit-for-bit unchanged.

If anything in section 5 violates these, that section is wrong and needs revision.

---

## 8. Out of scope

Things deliberately **not** in this addendum:

- **Kiosk fallback URL list / runtime access-point switching.** Defer to v1.1 per §4.3.
- **Biometric punch (fingerprint, face).** Hardware integration is a separate project.
- **GPS-fenced punching.** Different feature, separate concern.
- **Native mobile app for kiosks.** PWA is the target; native is out of scope.
- **Direct payroll processing** (vs. export to ADP/QBO/Paychex/Square). Export-only stays the model.
- **SSO with other Vibe apps.** Each app keeps its own auth.

---

## 9. Definition of done

This addendum is complete when:

1. All three PRs are merged.
2. A new image tag is published to GHCR with both architectures.
3. `docker pull` works from a fresh DO droplet on amd64 and from an arm64 host.
4. Standalone install on a fresh Ubuntu 24.04 droplet via `scripts/install.sh` produces a working app — same behavior as before this work, including multi-tenant mode for customers using it.
5. Appliance integration test: parent appliance compose with this app's overlay brings up Vibe-Payroll-Time at `time.<test-domain>` with manager login working, employee self-service working, and kiosk mode functioning at `https://time.<test-domain>/kiosk?location=1`.
6. Tailscale access test: `https://time.<test-tailnet>.ts.net/kiosk?location=1` works on a tablet joined to the test tailnet, including offline punch-and-sync.
7. Emergency-access test: with Caddy stopped, `http://<lan-ip>:5192/` allows manager login and timesheet review; `http://<lan-ip>:5192/kiosk?location=1` shows the explanatory page (not the kiosk UI).
8. DST regression tests pass for both spring-forward and fall-back boundaries.
9. Multi-firm migration test: a `TENANT_MODE=multi` DB with two firms refuses to start in `TENANT_MODE=single` mode with a clear error.
10. The eight backward-compat commitments in §7 hold under regression testing.

When that's true, the appliance Phase 5 (Vibe-Payroll-Time integration) reduces to the four-step task described at the end of §6.
