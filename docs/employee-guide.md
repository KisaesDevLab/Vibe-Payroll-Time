# Employee Guide

How to clock in, clock out, take a break, and check your hours.

## Install the app on your phone (personal device)

1. Your admin will send you a magic-link invite or give you an email + password.
2. Open the link in Chrome (Android) or Safari (iPhone).
3. Sign in and tap **Add to Home Screen**. The icon behaves like a native app.
4. Punches taken while the phone is offline are saved and will sync when you
   reconnect — a small banner will say "offline — punches will sync" until it
   catches up.

## Clocking in and out

- Tap **Clock in** — optionally pick a job from the list.
- Tap **Start break** / **End break** as needed.
- Tap **Switch job** to change the job you're on without ending your shift.
- Tap **Clock out** at the end of your shift. Your hours appear immediately on
  **Timesheet**.

Only one shift can be open at a time. If you forget to clock out, the appliance
will close the shift at the company's cutoff (typically 12 hours) and flag it
— tell your supervisor so they can correct the end time.

## Using the kiosk

At the shared tablet at your job site:

1. Enter your 4–6 digit **PIN**.
2. Pick **Clock in**, **Start break**, etc. The kiosk shows your name for two
   seconds to confirm.
3. Tap done; the kiosk returns to the PIN keypad for the next employee.

The kiosk does not store your password, and the session times out in five
minutes — another employee entering their PIN cannot see your history.

## Checking your timesheet

Tap **Timesheet** to see your week-to-date and pay-period-to-date hours.

- Weekly OT is computed under FLSA 40-hour rules.
- Missing clock-out? It shows as an **open** entry with a yellow dot.
- Any red dot = an **exception** that needs your supervisor's attention.

If you spot an error in a closed entry, tap **Request correction**, describe
the fix, and your supervisor will see it on their queue. If they approve it,
the entry is updated and the change is recorded in the audit trail with your
original request attached.

## Notifications (optional)

- **Email**: your admin has configured this company-wide. You'll get missed-
  punch reminders and weekly summaries if enabled.
- **SMS**: add your phone number under **Notifications** and verify the 6-digit
  code we text you. You can disable individual notification types there too.

## Privacy

- The app never tracks your location or photographs you.
- It does not identify your device to other employees.
- Your PIN is hashed on the server; even the SuperAdmin cannot read it back.

## Weekly grid

Your **My timesheet** page has a **Grid view** tab. Seven days across,
jobs down. Tap any cell to edit or add time.

- Cell with **PUNCHED** tag → your clock-in/out on that day already
  covers this job. Tap to override; override requires a reason.
- Cell with **MANUAL** tag → a manual entry; tap to edit the number or
  the reason.
- Blank cell with a dash → nothing logged yet. Tap to add.

If your company has set "override only" policy, you'll see a message
when you try to add time on a day+job you didn't actually punch for.

### Accepted input formats

Inputs accept any of these styles — the grid auto-detects:

- **Decimal:** `5`, `5.0`, `5.80`, `.5` → hours
- **HH:MM:** `5:48`, `0:30`, `8:00`
- **Labeled:** `5h 48m`, `5hr 48min`, `5 hrs`, `48 min`, `90m`

Rejected inputs tell you why (e.g., "5:60" → "Minutes must be 0–59";
"5 48" → "That's ambiguous — use 5:48 or 5.48").

## Time format preference

**User menu → Preferences → Time format.** Flip between decimal and HH:MM
at any time. Hours everywhere in the app re-render instantly — this is
a display setting only, it never changes the actual time stored.
