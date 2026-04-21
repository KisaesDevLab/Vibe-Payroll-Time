# Vibe Payroll Time — Addendum: QR Badge Authentication

Drop-in addendum to `BUILD_PLAN.md`. Slots in as **Phase 4.5** between Phase 4 (Auth surfaces) and Phase 5 (Punch engine). Does not alter any existing phase's deliverables; adds one column to `employees` and one column to `company_settings`, both nullable, with safe defaults.

**Positioning note:** QR badges are an anti-buddy-punching feature, not a surveillance feature. They do not change the landing-page non-goals list. No GPS, no photo, no biometric, no location data — a QR code is just a faster, more forgery-resistant way to identify an employee at a shared kiosk than typing a 4–6 digit PIN.

---

## Why this earns a phase

- Field-service / warehouse / restaurant employees regularly punch at a shared kiosk; typing a PIN slows them down and invites shoulder-surfing
- Badges are cheap to print, laminate, or clip to a lanyard — hardware cost is effectively zero
- Modern tablet browsers natively support camera access via `getUserMedia()` and QR decode via `@zxing/library` — no native code, no app store, still PWA-only
- Signed-token badge payloads are meaningfully harder to forge than a four-digit PIN that two employees might share

## Scope

- **In:** QR badge generation (per-employee), badge printing (PDF sheet), kiosk camera scanner, badge revocation, kiosk auth-mode toggle (PIN / QR / both)
- **Out:** GPS. Photo verification. Biometric. Badge-scanning from a personal phone (kiosk-only for v1). NFC / RFID / barcode formats other than QR.

---

## Phase 4.5 — QR Badge Authentication

Goal: employees can punch at a kiosk by presenting a printed QR badge to the tablet's camera, as a faster and less shareable alternative to the 4–6 digit PIN.

### Data model

- [ ] Migration: add `employees.badge_token_hash` (VARCHAR NULL) — stores HMAC-hashed badge payload; null means no badge issued
- [ ] Migration: add `employees.badge_issued_at` (TIMESTAMPTZ NULL)
- [ ] Migration: add `employees.badge_revoked_at` (TIMESTAMPTZ NULL)
- [ ] Migration: add `employees.badge_version` (INTEGER NOT NULL DEFAULT 0) — increments every reissue, invalidates old physical badges
- [ ] Migration: add `company_settings.kiosk_auth_mode` ENUM `pin` | `qr` | `both` NOT NULL DEFAULT `pin`
- [ ] Migration: partial unique index on `(company_id, badge_token_hash)` WHERE `badge_revoked_at IS NULL`
- [ ] Migration: add `badge_events` table (id, company_id, employee_id, event_type ENUM `issue`|`revoke`|`scan_success`|`scan_failure`, actor_user_id NULL, kiosk_device_id NULL, created_at, metadata JSONB)

### Badge token format

- [ ] Payload is a compact URL-safe string: `vpt1.{company_uuid}.{employee_uuid}.{badge_version}.{nonce_8b}.{hmac_16b}`
- [ ] HMAC-SHA256 signed with the appliance's badge-signing secret (new env var `BADGE_SIGNING_SECRET`, generated at install time, 32 bytes base64)
- [ ] Server-side verify checks: HMAC validity, company_id matches scanning kiosk's company, employee exists and is active, `badge_version` matches current, `badge_revoked_at IS NULL`
- [ ] The `badge_token_hash` stored on the employee row is `sha256(payload)` — the raw payload only exists on the printed badge, never persisted server-side after generation
- [ ] Key rotation path documented: bumping `BADGE_SIGNING_SECRET` invalidates every badge in the appliance; recovery is bulk-reissue

### Backend — badge service

- [ ] Service: `issueBadge(companyId, employeeId, actorUserId)` — increments `badge_version`, generates new payload, stores hash, returns raw payload exactly once (never retrievable again)
- [ ] Service: `revokeBadge(companyId, employeeId, actorUserId, reason)` — sets `badge_revoked_at`, writes `badge_events` row
- [ ] Service: `verifyBadge(payload, kioskDeviceToken)` — returns `{employee_id, company_id} | null`; logs to `badge_events` regardless of outcome
- [ ] Rate limit on `verifyBadge` per kiosk device: 20 scans per minute; bursts of bad scans trigger a 60-second lockout on that kiosk with audit log entry
- [ ] Endpoints:
  - [ ] `POST /api/v1/employees/:id/badge/issue` (CompanyAdmin, scoped) → returns `{payload, badge_version, issued_at}`; payload only returned on this response
  - [ ] `POST /api/v1/employees/:id/badge/revoke` (CompanyAdmin, scoped)
  - [ ] `POST /api/v1/kiosk/scan` (kiosk device token) → verifies + returns employee context for action screen, same payload shape as PIN-entry success
  - [ ] `POST /api/v1/employees/bulk-badges` (CompanyAdmin) → issues badges for a selection of employees in one transaction, returns a printable PDF sheet
  - [ ] `GET /api/v1/employees/:id/badge/events` (CompanyAdmin) → recent issue/revoke/scan events

### Backend — PDF badge sheet

- [ ] Puppeteer-based PDF generator (same dependency used for PDF exports in Phase 13)
- [ ] Template: Avery 5392 name-badge or similar standard stock (configurable per company)
- [ ] Per-badge content: employee name, employee number, QR code (generated server-side via `qrcode` npm package, level-H error correction for laminate/smudge tolerance), company name/logo, small legal disclaimer
- [ ] Option to regenerate just replacements (subset) vs. reissue-all
- [ ] Watermark: `badge_version` number printed in small mono-font on each badge so admins can distinguish active vs. superseded badges in a stack

### Frontend — kiosk scanner

- [ ] New kiosk UI mode driven by `company_settings.kiosk_auth_mode`:
  - `pin` — unchanged from Phase 4
  - `qr` — camera viewfinder full-width, PIN keypad hidden, "Can't scan? Use PIN →" fallback link
  - `both` — camera viewfinder on top, PIN keypad below, either works; successful scan skips the keypad entirely
- [ ] Camera access: `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })`
- [ ] Decoder: `@zxing/library` running in a Web Worker so main thread stays responsive during continuous scanning
- [ ] Scan rate: attempt decode at 10fps (not 30) — reduces CPU on cheap tablets without hurting UX
- [ ] Viewfinder overlay: centered target box with corner brackets and a subtle brass scan-line animation; flash-on-success animation when a valid code is decoded
- [ ] Error states:
  - Camera permission denied → instructs admin to re-pair or grant permission in browser settings
  - No camera available → falls back to PIN mode silently, writes a diagnostic event
  - Decoded-but-invalid badge → red flash + "Badge not recognized — see your manager" toast; logged to `badge_events` as `scan_failure`
  - Decoded-but-revoked badge → amber flash + "Badge is no longer active — use your PIN or see your manager"
- [ ] Rate-limit UX: if the 20/min cap hits, kiosk shows a 60-second cooldown screen (same pattern as PIN lockout)

### Frontend — kiosk pairing update

- [ ] Pairing flow (from Phase 4) extended: after device token exchange, check `kiosk_auth_mode` for the company
- [ ] If mode requires camera, immediately request camera permission as part of pairing — fails loudly if denied so admins discover the problem during setup, not first-punch
- [ ] Pairing success screen confirms: "Camera access: granted · Scanner: ready"

### Frontend — admin UI

- [ ] Employee roster table gets a new "Badge" column with one of four states: None / Active (vN) / Revoked / Reissue pending
- [ ] Employee detail drawer gains a Badge panel:
  - Issue button (if none) / Reissue button (if active) / Revoke button
  - After issue: modal shows the QR code on screen + "Download PDF" button; dismissing the modal is explicitly non-recoverable (payload is gone)
  - History: last 10 badge events
- [ ] Roster bulk action: "Issue badges for selected" → generates combined PDF sheet
- [ ] Company settings → Punch Rules: radio control for `kiosk_auth_mode` (PIN / QR / Both) with explanatory helper text

### Audit + reports

- [ ] `auth_events` (existing) gains badge-related event types so SuperAdmin activity log surfaces them
- [ ] New report: "Badge activity" — issued, revoked, scan-success, scan-failure counts per employee for a date range
- [ ] Audit trail on every time_entry already records `source` — existing kiosk source is preserved; `source_device_id` carries the kiosk ID either way. No new column needed to distinguish QR-auth vs. PIN-auth punches; that lives in `auth_events` keyed to the kiosk + timestamp.

### Tests

- [ ] Unit: HMAC verify rejects tampered payloads, rejects cross-company payloads, rejects revoked badges, rejects wrong-version badges
- [ ] Unit: issuing a new badge invalidates the prior version (old payload verify → fail)
- [ ] Unit: rate limiter trips at 21st scan, resets after 60 seconds
- [ ] Integration: pair a kiosk → issue badge → scan succeeds → punch created with `source = kiosk` and audit chain correct
- [ ] Integration: revoke badge → subsequent scan returns unauthorized with `scan_failure` event logged
- [ ] Integration: `kiosk_auth_mode = qr` hides PIN keypad; `both` shows both; `pin` hides scanner (no camera permission even requested)
- [ ] E2E (optional): Playwright scripted camera via virtual device feeding a known QR image, verifies full happy path

### Docs

- [ ] `docs/kiosk-setup.md` addendum: camera-permission walkthrough, recommended tablets, badge printing guide, laminate-vs-bare-paper tradeoffs
- [ ] `docs/security.md` addendum: badge token lifecycle, key rotation procedure, what an attacker with a photo of a badge can and cannot do
- [ ] `docs/admin-guide.md` addendum: issuing, revoking, bulk-printing badges

---

## CLAUDE.md — patch set

Apply these edits to `CLAUDE.md` when merging the addendum:

### Add to the Stack table

```
| QR decoding | @zxing/library (Web Worker), qrcode (server-side generation) |
| PDF generation | Puppeteer — shared with Phase 13 PDF reports |
```

### Amend the "Auth surfaces" section

Replace the kiosk bullet:

> **Kiosk mode** — device-paired kiosk token, employee enters PIN (4–6 digits) at shared tablet

with:

> **Kiosk mode** — device-paired kiosk token. Employee identifies with PIN (4–6 digits), QR badge scan, or both — admin picks `kiosk_auth_mode` per company. Badge payloads are HMAC-signed with an appliance-wide secret and verified server-side; raw payloads exist only on the printed badge.

### Amend the explicit non-goals

No change. GPS / photo / biometric remain non-goals. QR badges are auth, not surveillance.

### Add to "Common pitfalls"

- **Don't store raw badge payloads server-side.** Only the hash lives in the DB; the payload exists exactly once (in the API response to `issueBadge`) and then only on the printed badge.
- **Don't skip the `badge_version` check.** Reissuing a badge must invalidate every prior physical badge immediately, not on next verification.
- **Don't request camera permission outside of kiosk pairing.** A personal-device PWA should never ask for camera — badges are kiosk-only for v1.
- **Don't forget the audit event on scan failures.** Silent failures are how shared-badge abuse goes undetected; every bad scan logs to `badge_events`.

---

## Running counts after addendum

- Phases: 15 (0–13 + 4.5)
- Checklist items: ~295 (was ~270; +~25 for Phase 4.5)
- Scope still well under Vibe TB's 898 items
- No existing phase grows in size
- No additional infrastructure dependencies (Puppeteer already planned for Phase 13; we pull it forward)
- `company_settings` schema picks up one nullable-with-default column; `employees` picks up three; one new table (`badge_events`). All additive.

## Pricing / licensing

No tier changes. QR auth is a core-product capability across all tiers — including the free Internal Use path — because it's an auth feature, not a premium feature. Charging for it would contradict the "discipline is the feature" positioning.
