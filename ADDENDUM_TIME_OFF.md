# Vibe Payroll Time — Addendum: Time-Off Job Codes (Level 1 PTO)

Drop-in addendum to `BUILD_PLAN.md`. Adds the minimum viable path for recording PTO, sick, holiday, and unpaid-leave hours without building a PTO engine.

Slots in as **Phase 6.7** — a small rider on top of Phase 6.6 (Grid UI), between the grid UI phase and Phase 7 (Time math). Does not alter any existing phase's deliverables.

**What this is:** time-off is just a job code with a flag. Manual entries against time-off job codes reuse the entire manual-entry stack from Phase 6.5. No accrual tracking, no balance, no carry-over, no request-approval workflow. Firms that need balance management handle it in their existing systems (QuickBooks, payroll provider, spreadsheet) — this addendum only ensures time-off hours can be _recorded_ and _exported_ cleanly.

**What this is not:** A PTO engine. See the "Explicit non-goals" section below.

---

## Positioning note

The landing page FAQ currently says "No scheduling, no PTO engine." This addendum keeps that promise precise: we add PTO _entry_, not PTO _tracking_. One word changes in the FAQ: "No PTO engine" → "No PTO **accrual** engine." Everything else about the positioning holds.

The CPA-firm audience buys this tool partly because it doesn't pretend to manage PTO balances. A landscaping client with a seasonal crew doesn't need accrual policies — they need a way to log "Bob took 8 hours PTO on Monday" and have it flow to the payroll export correctly. This addendum delivers exactly that.

---

## Locked decisions

1. **Default time-off job codes seeded on every new company:** `PTO`, `SICK`, `HOLIDAY`, `UNPAID`. Admin can rename, deactivate, or add more.
2. **Time-off hours do NOT count toward FLSA 40-hour weekly overtime.** Federal rule — PTO is paid-but-not-worked time, and OT is based on hours actually worked. Covered in the time-math module.
3. **Employees can enter time-off on themselves,** subject to the same `employee_manual_entry_mode` company setting as any other manual entry. Default: allowed.
4. **Employee self-service shows worked hours and time-off hours as separate totals.** "Hours worked this period" stays worked-only; a second "Time off this period" line appears alongside it.

---

## Phase 6.7 — Time-Off Job Codes

Goal: a company can record PTO / sick / holiday / unpaid hours through the existing manual-entry path, with clean separation in totals, reports, and payroll exports.

### Data model

- [ ] Migration: add `jobs.is_time_off` (BOOLEAN NOT NULL DEFAULT `false`)
- [ ] Migration: add `jobs.time_off_category` (VARCHAR NULL) — canonical categories: `pto`, `sick`, `holiday`, `unpaid`, `other`; null when `is_time_off = false`. Enum enforced at service layer, not DB, to keep the column flexible if firms want company-specific categories later.
- [ ] Migration: add `jobs.is_paid` (BOOLEAN NOT NULL DEFAULT `true`) — `true` for PTO/sick/holiday (shows on paystub, gets exported), `false` for unpaid leave (logged for attendance but pays $0). Independent of `is_time_off` because the combinations matter: unpaid-but-not-time-off would be rare but legal.
- [ ] Check constraint: if `is_time_off = true` then `time_off_category IS NOT NULL`
- [ ] Migration: seed script on first-run / new-company creation creates four default time-off jobs per company:
  - [ ] `PTO` — `is_time_off=true, time_off_category='pto', is_paid=true`
  - [ ] `SICK` — `is_time_off=true, time_off_category='sick', is_paid=true`
  - [ ] `HOLIDAY` — `is_time_off=true, time_off_category='holiday', is_paid=true`
  - [ ] `UNPAID` — `is_time_off=true, time_off_category='unpaid', is_paid=false`
- [ ] New-company wizard includes a single "Include default time-off job codes" checkbox, checked by default. Unchecking creates no time-off jobs; admin can add them later one-by-one.

### Admin UI — Jobs page

- [ ] Job create/edit form gains two fields:
  - [ ] "This is a time-off code" checkbox
  - [ ] When checked: a category dropdown (PTO / Sick / Holiday / Unpaid / Other) and a "Is paid" checkbox (defaults true)
- [ ] Job list filter: chips for `All / Billable / Time off`
- [ ] Time-off jobs rendered with a distinct visual treatment in the list (small badge icon) so admins can spot them at a glance
- [ ] Archiving a default time-off job code shows a confirmation warning ("This is one of the default PTO job codes. Archiving it will prevent new entries but preserve historical ones.") — no hard prevention, just friction

### Grid UI — weekly grid view

- [ ] Time-off jobs appear in the grid's job-list selector in a separate section at the bottom: "Time off"
- [ ] Weekly grid cells for time-off jobs render with a subtle visual treatment distinguishing them from worked hours (light brass tint on the cell background, small "PTO" / "SICK" / "HOL" / "UNPD" badge in the corner)
- [ ] Cell-edit popover for time-off cells: same popover as worked-hours cells but without the "PUNCH OVERRIDE" notice (time-off entries never override punches; there's no punch for a day off)
- [ ] Reason field on a time-off entry is optional (worked-hours manual entries require reason; time-off entries don't — an employee taking a vacation day shouldn't have to justify it to type it in)
- [ ] Grid footer totals split into two lines:
  - [ ] Line 1: `Worked hours` — sums all non-time-off entries
  - [ ] Line 2: `Time off` — sums all time-off entries, broken out by category (`PTO 16:00 · SICK 0:00 · HOLIDAY 8:00`)
- [ ] Grand total pill shows both: `Worked: 32:15 + Time off: 24:00 = Total pay: 56:15`
- [ ] OT row in the footer only reflects worked hours, per FLSA; a visible note `"Time off hours do not count toward OT (FLSA)"` appears beneath the OT breakdown so the rule is never a surprise

### Grid UI — multi-employee grid

- [ ] Day-cell rendering unchanged (still shows total hours worked for the day)
- [ ] Additional visual indicator: a small teal tag in the cell corner if the employee has time-off entries on that day
- [ ] Status column may show a `Time off` pill in muted color for employees whose week is 100% time-off hours
- [ ] Stat row gains a 5th card: `Time off this week` showing total hours across all employees broken down by category in a small legend

### Employee self-service

- [ ] Phone PWA and employee timesheet list both surface two totals side-by-side:
  - [ ] `Worked this period: 31:48`
  - [ ] `Time off this period: 8:00 PTO`
- [ ] No accrual display anywhere — no "remaining balance," no "year-to-date used," nothing that would imply the system tracks balances it does not
- [ ] Employees can add time-off entries from the weekly grid view if `employee_manual_entry_mode = allowed` on their company
- [ ] Employees cannot add time-off entries if mode is `override_only` or `disabled` — manager path only

### Time math (Phase 7 interactions)

- [ ] `shared/time-math/` summary builder adds a new output key alongside the existing totals:
  - [ ] `worked_hours` — sum of non-time-off, non-superseded entries
  - [ ] `time_off_hours` — sum of all time-off entries, broken down by category: `{pto, sick, holiday, unpaid, other}`
  - [ ] `paid_time_off_hours` — sum where `is_paid = true` (convenience for payroll export)
  - [ ] `unpaid_time_off_hours` — sum where `is_paid = false`
- [ ] OT computation reads `worked_hours` ONLY. This is the FLSA-correct behavior — paid time off does not contribute to the 40-hour weekly threshold
- [ ] Edge case handled: an employee with 38 worked + 8 PTO in a week = 46 total pay hours, 0 OT hours, regardless of whether the PTO is on a workday or weekend
- [ ] Fuzz test addition: random mix of worked and time-off entries; OT calculation always matches `max(0, worked_hours - 40)` regardless of time-off presence

### Reports (Phase 8 interactions)

- [ ] **Time card by employee** — new row group below existing worked-hours breakdown: "Time off" section with one row per category having non-zero hours
- [ ] **Hours by pay period** — new columns: `Worked hrs`, `PTO hrs`, `Sick hrs`, `Holiday hrs`, `Unpaid hrs`, `Paid total`, `All total`
- [ ] **Hours by job** — time-off jobs rendered in a separate section at the bottom of the pivot, labeled "Time off"
- [ ] **Overtime report** — caption updated: "FLSA overtime computed on worked hours only. Time-off hours excluded from 40-hour threshold."
- [ ] **Audit trail** — unchanged; time-off entries appear in the trail like any other manual entry
- [ ] **New report: Time-off by period** — rows = employees, columns = categories (PTO / Sick / Holiday / Unpaid), cells = hours. One page, fits a letter sheet. Because this is what a CPA will be asked for at year-end.

### Payroll exports (Phase 9 interactions)

- [ ] **Payroll Relief exporter** — documented PTO/sick/holiday hour columns filled from `time_off_hours` breakdown; unpaid time off exported as zero-dollar rows for attendance record-keeping only. Needs verification against Thomson Reuters spec during Phase 9 research.
- [ ] **Gusto exporter** — separate pay items for `Regular`, `PTO`, `Sick`, `Holiday`; Gusto has native support for these item types, map directly
- [ ] **QBO Payroll exporter** — uses QBO's "pay type" convention; PTO / Sick / Holiday hours exported as distinct time-activity rows with the appropriate payroll item
- [ ] **Generic CSV exporter** — default columns extend with `worked_hours`, `pto_hours`, `sick_hours`, `holiday_hours`, `unpaid_hours`, `total_paid_hours`, `total_all_hours`
- [ ] Preflight check: no change needed; unapproved entries block export regardless of category
- [ ] CSV format preference (decimal vs HH:MM from the format addendum) applies uniformly across all hour columns, worked and time-off alike

### Notifications

- [ ] No new notification types. Employees submitting time off don't trigger a request-approval workflow (there isn't one — it just goes through the normal pay-period approval)
- [ ] Missed-punch reminder cron: unchanged — time-off entries are never "open" (they're always complete with a duration)

### AI features (Phase 11 interactions)

- [ ] Natural-language correction tool gains awareness of time-off categories. Example: `"Log 8 hours PTO for Marcus on Monday April 14"` resolves to `{employee: marcus, job: PTO, day: 2026-04-14, hours: 8, reason: null}` and shows a diff preview
- [ ] System prompt updated to explain the time-off job-code concept and the list of default categories
- [ ] Rate limit unchanged

### Tests

- [ ] Unit: OT calculation with worked-only, time-off-only, and mixed weeks — verifies FLSA rule in every case
- [ ] Unit: grid summary splits correctly into `worked_hours` / `time_off_hours` / `paid_time_off_hours`
- [ ] Unit: new-company seed creates four default time-off jobs; unchecking the wizard option creates zero
- [ ] Integration: create PTO entry → verify appears in time-off section of grid, not worked section → verify OT computation ignores it → verify report shows it in the PTO column
- [ ] Integration: employee with `employee_manual_entry_mode = override_only` cannot create a pure PTO entry (no punch to override)
- [ ] Integration: unpaid time off exports as zero-dollar row but non-zero hours — verifies the `is_paid` distinction preserves in CSV
- [ ] Integration: archiving a default time-off job does not delete historical entries referencing it

### Docs

- [ ] `docs/admin-guide.md` addendum: setting up custom time-off categories beyond the four defaults, configuring the wizard, disabling employee self-entry for PTO
- [ ] `docs/employee-guide.md` addendum: how to log a vacation day, how to view your worked-vs-time-off split
- [ ] `docs/integrations.md` addendum: how each payroll export maps time-off hours to the target system's native pay items; what the CPA firm needs to have set up on the payroll side for the export to land cleanly
- [ ] Explicit non-goals document updated: "No PTO engine" → "No PTO accrual engine. We record PTO; we do not track balances."

---

## Explicit non-goals (still, firmly)

None of these are in scope for Phase 6.7 or any subsequent phase without a deliberate product decision:

- ❌ **PTO balances.** No "remaining hours" displayed anywhere. If an employee has used 14 hours of PTO this year, Vibe PT knows that fact but shows it as "used" not as "remaining."
- ❌ **Accrual policies.** No rules like "earn 3.08 hrs / pay period" or "40 hrs lump sum on Jan 1." The firm's existing systems track accrual.
- ❌ **Carry-over / use-it-or-lose-it rules.** No year-end reset logic.
- ❌ **PTO request workflow.** Employees do not submit requests that manager approves separately from timesheet approval. A PTO entry is a manual entry; it goes through the same timesheet approval as worked hours.
- ❌ **Tenure-tiered accrual** (10 hrs/period for year 1, 15 hrs/period for year 3+).
- ❌ **Holiday pay multipliers.** We record holiday hours; we don't compute 1.5× premium on them. The payroll export carries the hours; the payroll provider applies the multiplier per its own rules.
- ❌ **Leave type beyond the four defaults + user-defined custom.** No specialized jury-duty, bereavement-tiered, FMLA tracking, military-leave logic. Firms with these needs add a job code called "BEREAVEMENT" or whatever and treat it like any other custom category.

If a client asks for any of these, the answer is: "That's a PTO _management_ system. We're a PTO _recording_ system. QuickBooks Time, BambooHR, and Rippling all do PTO management — pair us with one of those." This answer is not a deflection; it's the correct product boundary.

---

## CLAUDE.md — patch set

Apply these edits to `CLAUDE.md` when merging the addendum:

### Amend the "Explicit non-goals" section

Replace:

```
❌ Scheduling (shifts, templates, trades, availability, time-off requests, PTO accrual engine)
```

with:

```
❌ Scheduling — no shifts, no templates, no trades, no availability, no PTO accrual engine, no request/approval workflow separate from timesheet approval. Time-off hours ARE recordable as manual entries against time-off job codes; see "Time-off job codes" section.
```

### Add to the "Conventions" section

> ### Time-off is a job flag, not a separate concept
>
> Time-off hours live in the same `time_entries` table as worked hours, created through the same manual-entry service, approved through the same pay-period workflow. The only distinguishing feature is `jobs.is_time_off = true` and a `time_off_category`. Summaries split worked-vs-time-off at the aggregation layer; the underlying data model is unified. This means every query, audit path, and export code path exercises one path for both, with minimal branching.
>
> **FLSA rule encoded in code, not docs:** the OT calculator reads `worked_hours` only. Time-off hours never contribute to the 40-hour weekly threshold regardless of `is_paid` status.

### Add to "Common pitfalls"

- **Don't compute OT on total hours.** OT is `max(0, worked_hours - 40)`, never `max(0, total_hours - 40)`. A unit test guards this but it's worth re-stating.
- **Don't hide time-off entries from the audit trail.** They're manual entries, audited like any other. The fact that they're PTO doesn't make them less important to record changes to — if anything, more so, because wage-and-hour investigators look at PTO patterns.
- **Don't treat unpaid leave and zero-hour absences identically.** An employee who took 8 hours unpaid has 8 hours logged with `is_paid = false`. An employee who simply didn't work that day has 0 hours logged. Exports distinguish these.

---

## Running counts after this addendum

- Phases: 17 (0–13 base + 4.5 + 6.5 + 6.6 + 6.7)
- Checklist items: ~365 (was ~345; +~20 for Phase 6.7)
- Schema delta: 3 new columns on `jobs` (`is_time_off`, `time_off_category`, `is_paid`). One check constraint. Zero new tables. Zero changes to `time_entries`, `company_settings`, `users`, or any other existing column.
- No new dependencies. No new env vars. No new services.
- Every addition is additive; existing `is_time_off=false` job rows continue to work unchanged.

## Pricing / licensing

No tier changes. Time-off recording is a core capability in all tiers including Internal Use. Charging for it would contradict the core positioning that Vibe PT is a complete time-recording tool.
