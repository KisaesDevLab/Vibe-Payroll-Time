# Vibe Payroll Time — Addendum: Tabular Time Entry & Dual Format Support

Drop-in addendum to `BUILD_PLAN.md`. Adds two related capabilities:

1. **Weekly grid entry view** — spreadsheet-style time entry for employees (and managers acting on an employee's behalf) where cells allow manual entry that overrides punches with a reason, with full audit trail
2. **Multi-employee grid review view** — manager surface showing all employees × days for one week, click-to-drill-in
3. **Dual time format** — users can type and view time as decimal (`5.80`), HH:MM (`5:48`), or labeled (`5h 48m`); system auto-converts; per-user preference with per-company default

Slots in as **Phase 6.5** (manual entry engine) + **Phase 6.6** (grid UI + format module), sitting between Phase 6 (Timesheet and approval) and Phase 7 (Time math). Does not alter any existing phase's deliverables; storage stays `BIGINT seconds`, punch model unchanged, approval workflow unchanged.

**Positioning note:** This does not contradict any non-goal. It's a second entry modality for the same data model — punches remain the primary path, manual entry is a supervised override with reason. No scheduling, no PTO engine, no rates. The format toggle is a display concern, not a data-model change.

---

## Why this earns two phases

- CPA-internal salaried staff don't naturally punch in/out — they want end-of-day allocation in a familiar grid
- Managers covering for forgetful field crew need a fast override path that doesn't require them to manually create new punches from scratch
- Payroll processors and field crews have genuinely different format preferences (HH:MM vs. decimal) — forcing one creates ongoing friction
- Every commercial time-tracking competitor offers grid entry; the absence would be a conspicuous gap for CPA evaluators

## Scope

- **In:** Weekly grid entry (one employee, 7 days × jobs), multi-employee grid review (all employees × 7 days), manual-entry override with required reason, per-user format preference, per-company format default, lenient input parser, format-aware CSV exports
- **Out:** Bi-weekly / semi-monthly / monthly grid layouts (use period-nav arrows across multiple weekly views). Pre-rate / billable-rate columns (rates remain out-of-scope per core CLAUDE.md). Free-form time entry without a job code (every manual entry requires a job). Grid entry on mobile PWA (desktop/tablet-web only for v1; phone stays timer-first).

## Key design decisions locked

1. **Manual entries override punches with reason; original punches preserved in audit.** A new `time_entry` row with `source = web_manual` logically supersedes overlapping punch entries for that (employee, day, job). Punches get `superseded_by_entry_id`; audit trail records the full before/after.
2. **Edit authorization:**
   - Employee can manually edit own entries while pay period is unapproved
   - Supervisor can edit any employee's entries within their company scope, approved or not
   - Admin same as supervisor plus delete
   - Company setting `employee_manual_entry_mode` ENUM `allowed` | `override_only` | `disabled` further restricts employees; default `allowed`
3. **Pure manual entries count toward FLSA OT identically to punched hours.** No "admin/non-billable" exclusion at the data-model level. If a company wants to exclude a job code from OT counting, that's a future feature not in scope.
4. **Both grid views ship together.** Different entry points: weekly grid from an employee detail drawer or direct "my weekly timesheet" link; multi-employee grid as a toggle from the existing Manager list view.
5. **Grid layouts are weekly only.** Seven columns fits on a laptop without horizontal scroll; fourteen breaks scannability. Bi-weekly and semi-monthly pay periods are navigated as two or three weekly grids via the period-nav arrows.
6. **Format is a display + input-parse concern, not a storage concern.** Storage stays `BIGINT seconds` everywhere. No schema changes to `time_entries`. Preference lives on `users` with fallback to `company_settings`.

---

## Phase 6.5 — Manual Time Entry Engine

Goal: the data model, service layer, and audit chain for manual-entry overrides of punch data.

### Data model

- [ ] Migration: add `time_entries.source_web_manual` to the existing `source` ENUM (expand enum to include `web_manual` alongside `kiosk`, `web`, `mobile_pwa`)
- [ ] Migration: add `time_entries.superseded_by_entry_id` (BIGINT NULL, FK self-reference)
- [ ] Migration: add `time_entries.supersedes_entry_ids` (BIGINT[] NULL) — array for the manual entry to track which punch entries it replaced
- [ ] Migration: add `time_entries.entry_reason` (TEXT NULL) — mandatory when `source = web_manual`
- [ ] Migration: add `time_entries.is_manual` (BOOLEAN NOT NULL GENERATED ALWAYS AS (source = 'web_manual') STORED) — derived column for fast filtering
- [ ] Migration: index on `(company_id, employee_id, started_at) WHERE superseded_by_entry_id IS NULL` — the "active" view of a timesheet
- [ ] Migration: partial unique constraint — only one non-superseded manual entry per (employee, day, job) — prevents double-override bugs
- [ ] Migration: add `company_settings.employee_manual_entry_mode` ENUM `allowed`|`override_only`|`disabled` NOT NULL DEFAULT `allowed`
- [ ] Migration: add `company_settings.manual_entry_requires_approval` BOOLEAN NOT NULL DEFAULT `false` — extra guardrail for firms that want manager sign-off on every manual entry regardless of pay-period approval

### Backend — manual entry service

- [ ] Service: `createManualEntry({companyId, employeeId, jobId, day, durationSeconds, reason, actorUserId})`
  - [ ] Validates duration > 0 and ≤ 24 hours
  - [ ] Validates job is active and belongs to company
  - [ ] Validates day is not in a pay period that's already approved (unless actor is supervisor/admin)
  - [ ] Finds overlapping punch entries for (employee, day, job); sets their `superseded_by_entry_id` to the new entry
  - [ ] Creates new manual entry with `source = web_manual`, `started_at` = start-of-day in company TZ, `ended_at` = start-of-day + duration (time-of-day is irrelevant for pure manual entries; system stores a canonical stub time)
  - [ ] Requires non-empty `entry_reason`
  - [ ] Writes audit row with action `manual_override` including full list of superseded entries
  - [ ] Enforced in a transaction with SELECT FOR UPDATE on the employee's entries for that day
- [ ] Service: `updateManualEntry({entryId, newDuration, newReason, actorUserId})` — only updates existing manual; if duration becomes 0, delegates to delete
- [ ] Service: `deleteManualEntry({entryId, actorUserId, reason})`
  - [ ] Restores (unsets `superseded_by_entry_id` on) any entries this manual entry had superseded
  - [ ] Writes audit row with action `manual_revert`
  - [ ] Soft-delete via `deleted_at`, never hard delete
- [ ] Service: `getWeeklyGrid(companyId, employeeId, weekStartDate)` → returns `{jobs: [...], days: [{date, entries: [...]}], derived totals}` — shape optimized for the grid renderer
- [ ] Service: `getMultiEmployeeGrid(companyId, weekStartDate, employeeIds | null)` → returns `{employees: [{id, name, days: [{date, hours_seconds, has_manual, has_exception}]}], daily_totals, grand_total}`
- [ ] Authorization checks are a separate pure function `canManualEdit(actor, targetEmployee, entry, companyConfig)` — returns `{allowed: bool, reason: string}` — unit-tested independently of the service

### API endpoints

- [ ] `POST /api/v1/manual-entries` — create
- [ ] `PATCH /api/v1/manual-entries/:id` — update duration or reason
- [ ] `DELETE /api/v1/manual-entries/:id` — delete (soft)
- [ ] `GET /api/v1/timesheets/:employee_id/weekly-grid?week_start=YYYY-MM-DD` — weekly grid payload
- [ ] `GET /api/v1/timesheets/weekly-grid?week_start=YYYY-MM-DD&employee_ids=...` — multi-employee grid payload
- [ ] All endpoints return uniform error shape `{error: {code, message, details}}`

### Interactions with existing phases

- [ ] Phase 6 approval logic: approving a pay period locks both punch and manual entries; manual entries can still be added by supervisor/admin (with reason) post-approval
- [ ] Phase 6 correction-request flow: employees in `employee_manual_entry_mode = override_only` (or with manager-approval-required) funnel manual entries through the existing correction-request table, never directly creating rows
- [ ] Phase 7 time math: the weekly summary builder reads non-superseded entries only; OT computation is unchanged, it just sees manual entries like any other entry

### Tests

- [ ] Unit: creating a manual entry supersedes all overlapping punches for that day/job
- [ ] Unit: deleting a manual entry restores the superseded punches
- [ ] Unit: employee cannot create manual entry in an approved period; supervisor can
- [ ] Unit: `employee_manual_entry_mode = disabled` prevents employee-originated manual entries at the service layer (not just UI)
- [ ] Unit: manual entry with 0 seconds or > 24 hours is rejected
- [ ] Unit: manual entry without reason is rejected
- [ ] Unit: `canManualEdit` returns correct result for all 12 combinations of (role × mode × approval state)
- [ ] Integration: create punch → create manual override → approve → delete manual → punch visible again in summary
- [ ] Integration: two concurrent manual entries for the same (employee, day, job) — second one rejects cleanly with a unique-violation error surfaced as a clear user message

---

## Phase 6.6 — Grid UI & Dual Format Support

Goal: the two grid views (weekly entry, multi-employee review) plus the shared time-format module that powers input-parsing and display across every hour-bearing field in the app.

### `shared/time-format/` module

- [ ] New module in the existing `shared/` workspace — pure functions, zero DB deps, matched frontend and backend
- [ ] `parseHours(input: string): {seconds: number, matched: FormatKind} | {error: string}`
- [ ] Accepted formats:
  - [ ] Decimal: `5`, `5.0`, `5.80`, `5.8`, `.5`, `0.5` — integer or float, leading zero optional
  - [ ] HH:MM: `5:48`, `05:48`, `0:30` — zero or one leading zero, minutes must be 0–59
  - [ ] HH:MM:SS: `5:48:30` — seconds precision; accepted but behind a feature flag (`allowSecondsPrecision`) off by default
  - [ ] Labeled: `5h 48m`, `5hr 48min`, `5h48m`, `5 hrs`, `48 min`, `1h`, `30m` — lowercase normalized, space optional, order enforced hours-then-minutes
  - [ ] Plain minutes: `90m`, `90min` — without an hours component, accepted
  - [ ] Plain seconds: NOT accepted (ambiguous with decimal hours) — `90s` rejects
- [ ] Rejected inputs (return explicit error, never guess):
  - [ ] Empty string, whitespace only → `EMPTY`
  - [ ] Negative numbers → `NEGATIVE`
  - [ ] `>= 24 hours` when storing a single day's entry → `OVER_DAY` (caller can override for week totals)
  - [ ] Colon with more than 2 segments → `BAD_COLON_FORMAT`
  - [ ] Minutes ≥ 60 in HH:MM → `BAD_MINUTES`
  - [ ] Mixed separators (`5.30:15`) → `MIXED`
  - [ ] Letters other than `h`/`hr`/`hrs`/`m`/`min`/`mins` → `BAD_LABEL`
  - [ ] `5 48` (whitespace-separated numbers) → `AMBIGUOUS`
- [ ] `formatHours(seconds: number, mode: 'decimal' | 'hhmm', opts?: {precision, padHours}): string`
  - [ ] Decimal default: 2 decimal places, no trailing zero padding (`5.8` not `5.80`) unless `precision` overrides
  - [ ] HH:MM default: `H:MM` with minutes zero-padded, hours not padded (`5:48` not `05:48`); `padHours: true` yields `05:48`
  - [ ] Always rounds to whole minutes in HH:MM display (`5:28:12` → `5:28`); preserves underlying seconds for export paths
  - [ ] Zero renders as `0:00` / `0.00` (never empty or `—` — that's the caller's choice)
  - [ ] Negative seconds render as `(1:30)` / `(-1.5)` (caller chooses parentheses via opts)
- [ ] `formatHoursDual(seconds, primaryMode): {primary: string, secondary: string}` — helper for the dual-readout cells
- [ ] Helper: `minutesToHHMM(minutes)` / `secondsToHHMM(seconds)` — convenience wrappers
- [ ] Helper: `detectFormatKind(input)` — returns `'decimal' | 'hhmm' | 'labeled' | 'ambiguous'` for live parse-hint display
- [ ] Fuzz test: 10,000 randomly-generated strings; every accepted format round-trips exactly; every rejection returns a valid error code
- [ ] Golden-file test: canonical list of 200 input → expected output pairs covering every edge case

### User preference + company default

- [ ] Migration: add `users.time_format_preference` ENUM `decimal`|`hhmm` NULL — null means inherit from company
- [ ] Migration: add `company_settings.time_format_default` ENUM `decimal`|`hhmm` NOT NULL DEFAULT `decimal`
- [ ] Resolver: `resolveFormat(user, company): 'decimal' | 'hhmm'` — user preference wins, company default fallback
- [ ] API endpoint: `PATCH /api/v1/me/preferences` with `{time_format_preference: 'decimal' | 'hhmm' | null}`
- [ ] Frontend: user menu → Preferences → Time format radio, with live preview showing a sample cell in the chosen format

### Weekly grid view (employee-focused)

- [ ] Route: `/app/companies/:company/timesheets/:employee/week?start=YYYY-MM-DD`
- [ ] Entry points:
  - [ ] Employee detail drawer → "Weekly grid" button
  - [ ] Employee's own "My timesheet" → "Grid view" tab alongside "List view"
  - [ ] Direct deep link from calendar/dashboard
- [ ] Table layout: job rows × 7 day columns + total column; header shows dow/dom/today-highlight/weekend-tint
- [ ] Each cell renders:
  - [ ] Primary value in active format (big)
  - [ ] Secondary value in the other format (small, muted)
  - [ ] Source tag: `PUNCHED` / `MANUAL` / `MIXED` / empty-dash
  - [ ] Locked-approved indicator (green dot with checkmark) when entry is in an approved period
- [ ] Click on empty cell → cell-edit popover opens in "add" mode, job/date pre-filled from the cell's row/column
- [ ] Click on punched cell → cell-edit popover opens in "override" mode, pre-filled with the current punched value and showing the override notice
- [ ] Click on manual cell → cell-edit popover opens in "edit" mode with the existing reason
- [ ] Cell-edit popover contents:
  - [ ] Header: day + job-code
  - [ ] Override notice box (only when overriding a punch): `"PUNCH OVERRIDE · old → new"` with original punch time-window shown
  - [ ] Hours input (single field, accepts either format; label reads "type decimal or HH:MM")
  - [ ] Live parse-hint strip: `"You typed [input] → [parsed meaning] · = [other-format equivalent] · [stored seconds]"` — updates on every keystroke
  - [ ] Accepted-formats reference strip: four mini-examples (`5.80 decimal`, `5:48 HH:MM`, `5h 48m labeled`, `5.5 = 5:30`)
  - [ ] Format-adaptive quick-increment buttons: `+0:15 / +0:30 / +1:00 / 8:00` in HH:MM mode, `+0.25 / +0.50 / +1.00 / 8.00` in decimal mode; `Reset` always present
  - [ ] Reason textarea (required whenever the popover is in override or edit mode; optional when adding to an empty cell)
  - [ ] Save/Cancel actions
- [ ] Format toggle in toolbar: `DECIMAL · HH:MM` pill, active state reflects user preference, switching it updates preference in one click (debounced API call) and re-renders all cells
- [ ] "Copy last week" button: copies all non-superseded entries from prior week to current, skipping days that already have entries; prompts for single reason to attach to all
- [ ] Auto-save indicator: every cell edit posts on blur; indicator shows `"Saved 2s ago"` in brass when succeeded, `"Saving…"` during, `"Save failed — retry"` with click-to-retry on failure
- [ ] Undo: edits within the last 60 seconds can be reverted from a transient toast (`"Changed Fri Job 1311 to 5:48 · Undo"`); after 60s only admin edit/delete works
- [ ] Exceptions panel at the bottom of the grid (collapsed by default): offline-conflict entries, auto-closed entries, open entries, same patterns as Phase 6
- [ ] Submit for approval button (employee only): collects all unapproved entries in the visible pay period and marks them ready-for-approval
- [ ] Keyboard navigation: Tab / Shift-Tab to adjacent cells, Enter to open popover, Esc to close
- [ ] Multi-cell paste from Excel/Google Sheets: planned but gated behind feature flag for post-v1; not in scope for the initial ship

### Multi-employee grid view (manager-focused)

- [ ] Route: `/app/companies/:company/timesheets/grid?week=YYYY-MM-DD`
- [ ] Entry point: list↔grid view toggle next to existing Manager timesheet list
- [ ] Table layout: employee rows × 7 day columns + total column + status column
- [ ] Each day-cell renders:
  - [ ] Total hours worked that day (not broken down by job)
  - [ ] Red dot (top-right) if any exception on that day
  - [ ] Brass dot (top-right) if any manual entry on that day
  - [ ] Brass text color if the day contributes to weekly OT
  - [ ] Weekend tint
- [ ] Click day-cell → slides out a side panel with the employee's day breakdown (the same `detail-day` mini-grid used in the expanded-row pattern from Phase 6)
- [ ] Filter chips above the grid: `All / Pending / Exceptions / With manual / Approved`
- [ ] Stats row: employees this week / regular hours / OT / cells needing review
- [ ] "Approve all clean" bulk action — approves every employee who has no exceptions, no pending correction requests, and no overdue manual-entry reasons
- [ ] Format toggle works the same way; clicking updates user preference and re-renders
- [ ] Employee-row click opens the single-employee Weekly grid in a new tab
- [ ] Pagination: 20 employees per page; full data streams from the backend via a single request since payload is small

### Audit trail integration

- [ ] Every manual-entry create/update/delete writes to `time_entry_audit` with one of: `manual_create`, `manual_update`, `manual_delete`, `manual_override`, `manual_revert`
- [ ] Audit reason carries the format the user typed (`"typed 5:48 · stored 20880s"`) so reviewers can see both intent and canonical value
- [ ] Reports: Phase 8 audit report gets two new columns (original-entry-format, typed-input-string) for manual rows

### Exports

- [ ] Phase 9 export engine picks up format preference:
  - [ ] Generic CSV: column-mapper gains a format dropdown with both options; saved per template
  - [ ] Payroll Relief: decimal only (native format); user preference ignored
  - [ ] Gusto: decimal only (native format); user preference ignored
  - [ ] QBO Payroll: decimal only (native format); user preference ignored
- [ ] CSV column "source" now includes `web_manual` as a possible value alongside `kiosk`, `web`, `mobile_pwa`
- [ ] CSV column "override_reason" added for rows where `source = web_manual`
- [ ] Preflight gets a new check: no open-ended manual entries (can't happen structurally; assertion-only, catches DB corruption)

### Frontend components (reusable)

- [ ] `<HoursCell />` — renders `{seconds, primaryFormat}` with dual readout; handles the click-to-edit affordance
- [ ] `<HoursInput />` — wraps an `<input>` with live parse-hint, format-adaptive quick-buttons, and emits `(seconds | null, errorCode | null)` to the parent
- [ ] `<FormatToggle />` — the pill toggle used in both grids and in settings
- [ ] `<CellEditPopover />` — the full-featured popover including override notice, reason field, parse hint
- [ ] All four components styled with existing tokens from the frontend-design skill; tested in both format modes

### Tests

- [ ] Unit: `parseHours` accepts every format listed and rejects every ambiguous case
- [ ] Unit: `formatHours` round-trip — `parseHours(formatHours(N, mode))` returns N for every mode and every N in `[0, 86400]` step 1
- [ ] Unit: `HoursInput` component — typing triggers parse-hint update within 50ms of keystroke
- [ ] Unit: `<FormatToggle>` updates user preference and dispatches re-render event
- [ ] Component: weekly grid renders correctly with zero entries, all-punched entries, all-manual entries, and mixed state
- [ ] Component: multi-employee grid renders correctly with 100 employees (pagination correctness)
- [ ] Integration: open popover → type `5:48` → save → verify stored `time_entries` row has `source = web_manual`, `duration_seconds = 20880`, `entry_reason` non-null
- [ ] Integration: switch format toggle → every cell re-renders → no stored data touched
- [ ] E2E (optional): full weekly grid entry flow including "Copy last week" and auto-save success/failure paths

### Docs

- [ ] `docs/admin-guide.md` addendum: when to use grid entry vs. punch flow; configuring `employee_manual_entry_mode` per company
- [ ] `docs/employee-guide.md` addendum: weekly grid walkthrough, format preferences, accepted input formats with examples
- [ ] `docs/integrations.md` addendum: how generic-CSV format mapping interacts with payroll-provider native formats
- [ ] `docs/security.md` addendum: why manual entries preserve punches (audit defensibility for wage-and-hour investigations)

---

## CLAUDE.md — patch set

Apply these edits to `CLAUDE.md` when merging the addendum:

### Amend the Stack table

```
| Time format | shared/time-format/ — pure-function parser + formatter, 100% unit tested |
```

### Amend the "Punch model" section

After the existing `time_entry` description, add:

> Manual entries use `source = web_manual` and carry an `entry_reason`. A manual entry may supersede one or more punch entries for the same (employee, day, job); superseded entries remain in the DB with their `superseded_by_entry_id` set, never deleted. The "active" view of a timesheet is entries where `superseded_by_entry_id IS NULL`.

### Add a new "Time format" conventions subsection

> ### Time format is always a display concern
>
> Storage is `BIGINT seconds`, always. No cell in the UI, no column in a report, and no input field ever stores formatted time strings. The `shared/time-format/` module parses input strings to seconds and formats seconds to strings; frontend and backend import the same module so their validation agrees. User preference (`decimal | hhmm`) falls back to company default; both are display settings that never touch entry data.

### Add to "Common pitfalls"

- **Don't parse time-format strings with regex in route handlers.** Every route that accepts an hours field runs the input through `shared/time-format/parseHours` and stores the returned seconds. Never ad-hoc.
- **Don't round seconds to minutes on storage.** Storage is always exact seconds; only display rounds (to whole minutes for HH:MM, to configurable precision for decimal).
- **Don't silently normalize ambiguous input.** `"5 48"` is ambiguous and must return an error. Guessing is how manual entries become wage-and-hour claims.
- **Don't hard-delete a manual entry.** Soft-delete via `deleted_at`; restoration of superseded punches must happen in the same transaction.
- **Don't let a grid re-render without reading the user's current format preference.** Format is resolved server-side on every grid-payload response so client and server always agree.

---

## Running counts after addendum

- Phases: 16 (0–13 + 4.5 + 6.5 + 6.6)
- Checklist items: ~345 (was ~295; +~50 across the two new phases)
- Still well under Vibe TB's 898 items
- No existing phase grows in size
- Only additive schema changes: three new columns on `time_entries`, two on `company_settings`, one on `users`. One enum expansion.
- No new infrastructure dependencies. `shared/time-format/` is pure TypeScript.

## Pricing / licensing

No tier changes. Grid entry and dual format are core-product capabilities across all tiers including Internal Use. Charging for a format preference would embarrass us.
