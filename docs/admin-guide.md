# Admin Guide

You are a **CompanyAdmin** if you manage one of the companies hosted on this
appliance. (A **SuperAdmin** manages the appliance itself — see
`appliance-ops.md`.)

## First hour

1. **Log in.** Open the appliance URL in Chrome or Safari. Sign in with the
   email + password the SuperAdmin provisioned.
2. **Review company settings.** Go to **Settings** and confirm:
   - Timezone matches your payroll jurisdiction
   - Week-start day matches your payroll processor
   - Pay-period type (weekly / bi-weekly / semi-monthly / monthly) is correct —
     changing this later re-bins every historical timesheet
   - Rounding policy (e.g., nearest 15 minutes, quarter-past) — off by default
   - Auto-clock-out threshold (default 12h) — set to your longest legitimate shift
3. **Invite your team.** Go to **Team** to invite CompanyAdmins + Supervisors,
   and **Employees** to create employee records. Employees without a login email
   can still punch at a kiosk using their PIN. See
   [Getting people signed in](#getting-people-signed-in) for the two ways to
   hand out access.
4. **(Optional) Pair a kiosk.** From **Kiosks** generate a pairing code, open the
   kiosk URL on the tablet, and enter the code within five minutes.
5. **(Optional) Configure notifications.** Under **Settings → Email / SMS**, paste
   an EmailIt API key and/or Twilio credentials. These are stored encrypted.
6. **(Optional) Enable AI.** Under **Settings → AI**, turn on the toggle and
   paste an Anthropic key if you want natural-language timesheet corrections
   and the support chat bot. On appliances managed by the Vibe AI Router the
   provider and key fields show "Managed by Vibe AI Router" and there is
   nothing to paste — the toggle and daily correction limits are still yours.

## Getting people signed in

Two records control access, and personal-device punching needs both:

| Record            | Created at                   | Gives them            |
| ----------------- | ---------------------------- | --------------------- |
| User + membership | **Team → Invite user**       | The ability to log in |
| Employee          | **Employees → Add employee** | The ability to punch  |

Use the **same email address** on both and they link automatically — in either
order. An employee with no email stays kiosk-only (PIN or badge), which is the
intended setup for shared-device staff.

### Inviting someone

**Team → Invite user** offers two ways to get them in:

- **Send them a sign-in link** (recommended). No password is ever set. They get
  an email or text, click through, and choose their own. Nothing to read aloud,
  nothing to write down, nothing to rotate later.
- **Set an initial password myself.** You choose a 12+ character password and
  pass it along yourself. Use this when the appliance has no email or SMS
  transport configured.

Sending links requires EmailIt or an SMS provider under **Settings → Email /
SMS** (or the appliance-wide fallback a SuperAdmin sets). Without either, the
link option is disabled and only the manual-password path is available.

### Inviting from the employee record

You can also do all of this without leaving **Employees**, which is usually
where you already are:

- **Adding someone?** The **Add employee** form has a **Web login invite**
  section — tick "Email them a sign-in link" and/or "Text them a sign-in link".
  Both are off by default, since plenty of hourly staff are kiosk-only. An
  email address is required either way: it's the identity of the login account,
  even when the link goes out by text.
- **Someone already on the roster?** Open their record. The **Web login** panel
  shows one of three things:
  - _Enabled_ — with the same **Send link** menu described below.
  - _Not set up_, with an email on file — a **Create login & email link**
    button (plus **& text link** if they have a phone). One click creates the
    account and sends the invite.
  - _Not set up_, no email — they're kiosk-only. Add an email and save to
    enable web sign-in.

### Re-sending, and resetting a forgotten password

Every row on **Team**, and every employee record with a login, has a **Send
link** menu with four actions:

- Email / text a **sign-in link** — for "I never got the invite" and "I can't
  find the email you sent Tuesday". Valid 15 minutes, single use.
- Email / text a **password reset** — for "I forgot my password". Valid 30
  minutes, single use. Setting the new password signs the account out
  everywhere else, which is what you want if the reason they're locked out is
  that someone else got in.

You never see or set the new password — it goes straight from them to the
system. Re-send as many times as you need; admin-initiated sends don't count
against the person's own recovery limit.

SuperAdmins have the same control on **Appliance → People**, for any account on
the box including ones with no company memberships.

> **Check the phone number before you text.** An admin-initiated text goes to
> whatever number is on the employee record, confirmed or not — a new hire has
> no way to confirm a phone until they can sign in, and the text is how they
> sign in. That means a mistyped digit sends a working sign-in link to a
> stranger. The UI flags unconfirmed numbers when it sends. (Employees typing
> their own number into **Forgot your password?** on the login page still need
> a confirmed one — there the number is the lookup key, so an unconfirmed one
> would let anyone point someone else's account at their own handset.)

### If a send doesn't go out

The menu reports what actually happened, not just that the button worked. A
result of "Not sent" names the reason — no phone on file, phone not verified,
EmailIt not configured for this company or the appliance. Fix the underlying
cause and re-send; the notification log under **Settings → Notifications** has
the full history (message bodies for links are deliberately redacted so nobody
can copy someone else's sign-in link out of the log).

### Employees who can't self-serve

If the appliance has no email and no SMS transport at all, there is no
self-service recovery path — the login page says so. Recovery is: a CompanyAdmin
removes and re-invites the member with a new initial password, or a SuperAdmin
does the same from **Appliance → People**.

## Running the week

| Task                                                  | Where                            | Who                |
| ----------------------------------------------------- | -------------------------------- | ------------------ |
| Review open exceptions (missing punches, long shifts) | **Timesheets**                   | Supervisor / Admin |
| Approve correction requests from employees            | **Corrections**                  | Supervisor / Admin |
| Approve the pay period                                | **Timesheets → Approve**         | Admin              |
| Run the payroll export                                | **Exports**                      | Admin              |
| Spot-check the audit trail                            | any timesheet → **Audit** drawer | Admin              |

Approving a pay period locks employee edits for that window; correction
requests still route through the Supervisor / Admin.

## Employees

- Create an employee: **Employees → New employee**. Email is optional; without
  it, only kiosk punching is available.
- Regenerate a PIN: **Employees → row menu → Reset PIN**. The old PIN is
  invalidated immediately.
- Retire an employee: **Employees → row menu → Deactivate**. They disappear
  from pickers but existing punches and audit trail remain forever.

## Jobs

Optional. Jobs let employees tag a punch with a customer / project / cost code.
Enable under **Settings → Job tracking**. Individual jobs can be marked
billable or unbillable — it's just a label, since this app tracks hours only
(no rates, no dollars).

## When something goes wrong

- "Employee says the clock says 4:58 but the record says 5:02" — see **Audit**
  drawer; the entry shows the server-stamped time and the source device's
  reported clock skew.
- "An employee forgot to clock out Friday" — auto-clockout closes at
  started_at + auto_clockout_hours and flags the entry. Edit the entry to the
  correct time; the edit requires a reason and is audit-logged.
- "We accidentally approved a bad pay period" — SuperAdmin can unlock on
  request. Admins cannot unlock their own approval (prevents accidental
  tampering).

## When the appliance is offline

- **Personal-device PWA:** punches queue in the phone's IndexedDB; the banner
  shows "offline — punches will sync". On reconnect they flush automatically.
- **Kiosk:** same behavior, plus the kiosk is paired to this specific appliance
  and will reject an imposter server.

If the appliance itself is down, contact your SuperAdmin. Employees don't need
to do anything — their queued punches wait for the appliance to come back.

## QR badges

### Turning it on

**Settings → Punch rules → Kiosk authentication.** Choose:

- **PIN only** (default) — 4-6 digit keypad.
- **QR badge only** — camera-based scan; PIN fallback appears only if the
  camera is unavailable.
- **Both** — scanner + "Use PIN" link; whichever the employee does first wins.

Flipping this setting takes effect on paired tablets within a minute without
re-pairing.

### Issuing a badge

**Employees → row → Badge panel → Issue badge.** A modal shows the QR code
on-screen with **Download PNG** and **Print** buttons. Dismissing the modal
is non-recoverable — if you lose the code you must reissue, which invalidates
the old physical badge.

### Bulk issue

Tick the rows you want on the Employees page, then **Issue badges for N…**.
A new tab opens with a print-ready sheet (2-up Avery 5392-style layout). Use
your browser's Save-as-PDF or Print dialog. Every badge on the sheet is a
newly minted `vN+1` — any pre-existing badge for those employees stops
scanning.

### Revoking

**Employees → row → Badge panel → Revoke.** Instant. The kiosk shows "Badge
is no longer active — use your PIN or see your manager" on the next scan and
writes an audit row.

### Activity

The Badge panel shows the last 10 events per employee (issue / revoke /
successful scans / failed scans with reason). Useful for tracking a lost
badge or catching shared-badge abuse.

## Manual time-entry grids

Two surfaces for managers who need to enter or fix time without the
punch clock:

### Weekly grid (single employee)

From an employee row on **Employees**, click **Weekly grid**, or deep-link
to `/companies/:companyId/timesheets/:employeeId/week?start=YYYY-MM-DD`.

Jobs are rows, the seven days are columns. Click any cell to add a manual
entry, override an existing punch, or edit a prior manual. Every manual
entry carries a required reason that shows up in the audit trail and,
depending on your company settings, in payroll exports.

Punches are never deleted. A manual override marks overlapping punches as
superseded in the DB; delete the manual entry and the punch returns.

### Multi-employee grid

Toggle to **Grid view** on the Timesheets review screen, or visit
`/companies/:companyId/timesheets/grid?week=YYYY-MM-DD` directly. All
active employees × 7 days. Click an employee row to open their weekly
grid. Red dots = exceptions (open entries, auto-closed, etc.); amber
dots = days with manual entries. Filter chips at the top restrict the
table to specific subsets.

### Company policy for employee-originated manual entries

**Company settings → Manual entries** controls whether employees can
create manual entries on their own behalf:

- **Allowed** (default) — employees can add any manual entry to an
  unapproved period.
- **Override only** — employees may only adjust time on days they
  already punched; pure allocations (no punch on the day/job) are
  blocked. Supervisors/admins are not restricted.
- **Disabled** — only supervisors and admins can create manual entries.

Approved periods are always locked for employees regardless of mode. A
supervisor can still post a manual entry after approval — the audit row
makes the post-approval edit visible.

## Time format preference

**User menu → Preferences → Time format.** Either decimal (5.80) or HH:MM
(5:48). The value is remembered per user. Companies set a default for
their members under **Company settings → Display**; users may override.
The format toggle only affects how hours render — storage is always
exact seconds, so switching formats never touches data.

## Demo company

Every appliance ships with a seed for **Acme Plumbing Co** — one internal
company, six employees with working PINs, three job codes, and ~14 days
of realistic time entries (open shifts, auto-closed shifts, mixed
sources, edited entries). Useful for exploring the UI before onboarding
real people.

### Loading the demo

At install time, the installer asks you. For an existing appliance:

```bash
docker compose -f docker-compose.prod.yml exec api \
  npm run seed:run --workspace=backend
```

For a dev environment:

```bash
npm run seed:demo
```

The seed is idempotent — it deletes and recreates its own company on each
run, so any edits you made inside the demo are lost.

### Seed PINs

Alice `100623` · Bob `204816` · Carol `307291` · David `401375` ·
Eva `508264` · Frank `603571`.

### Boot-time flag

`SEED_DEMO_ON_BOOT=true` in `.env` re-seeds on every backend restart.
Handy for a demo VM that should always present fresh data; leave **off**
on any appliance where the demo's edits matter.
