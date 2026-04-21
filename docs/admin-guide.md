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
   can still punch at a kiosk using their PIN.
4. **(Optional) Pair a kiosk.** From **Kiosks** generate a pairing code, open the
   kiosk URL on the tablet, and enter the code within five minutes.
5. **(Optional) Configure notifications.** Under **Settings → Email / SMS**, paste
   an EmailIt API key and/or Twilio credentials. These are stored encrypted.
6. **(Optional) Enable AI.** Under **Settings → AI**, turn on the toggle and
   paste an Anthropic key if you want natural-language timesheet corrections
   and the support chat bot.

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
