# Employee Guide

How to clock in, clock out, take a break, and check your hours.

## Install the app on your phone (personal device)

1. Your admin will send you a sign-in link by email or text, or give you an
   email + password.
2. Open the link in Chrome (Android) or Safari (iPhone). Sign-in links are good
   for 15 minutes and work once — if yours expired, ask for another, or use
   **Forgot your password?** on the sign-in page.
3. Sign in and tap **Add to Home Screen**. The icon behaves like a native app.

## If you can't get in

On the sign-in page:

- **Email me a login link** / **Text me a login link** — signs you in without a
  password. Good for 15 minutes, one use. If you ask too often, the page tells
  you to wait a few minutes.
- **Forgot your password?** — sends a link that lets you choose a new one. Good
  for 30 minutes, one use. Setting a new password signs you out on your other
  devices.

Both say "if an account matches…" whether or not one does, so nothing is
revealed to someone typing in guesses. If no message arrives, check the address
or number your admin has on file — texts only reach a phone number you've
verified. Ask your admin to re-send; they can do it as many times as needed.

If your appliance has no email or texting set up, these options won't appear.
Ask your admin to reset your password for you.

If your company has turned off your sign-in, the sign-in page says so. You can
still clock in and out at the kiosk.

When your session expires, signing in again takes you back to the page you
were on.

## Clocking in and out

The **My time** page shows your company, your current status and the hours
you've worked today.

- Tap **Clock in**.
- Tap **Start break** / **End break** as needed.
- Tap **Clock out** at the end of your shift. Your hours appear on
  **My timesheet**.

**Lunch question.** If you clock out after 6 or more hours without a break,
the app asks "Did you take lunch?": **30 minutes**, **60 minutes** or
**worked through**. A 30 or 60 minute answer records an unpaid lunch break in
the middle of that stretch. Your company can turn this question off.

Only one shift can be open at a time. If you forget to clock out, the appliance
will close the shift at the company's cutoff (typically 12 hours) and mark it
**auto-closed** — tell your supervisor or use **Request fix** so the end time
gets corrected.

**Working for more than one company?** Pick the company from the list at the
top; the app remembers your choice and opens on the company you're clocked in
at. You can only be on the clock at one company at a time: clock out at the
first before clocking in at the second.

### No signal?

You can punch with no connection. The punch is saved on your phone with the
time you tapped, and the card shows your new status straight away. A banner at
the top says **Offline** and how many punches are waiting; they send by
themselves when the phone is back online (or tap **Sync now**). Signing out
doesn't lose them: they send the next time you sign in on that phone.

If the app was closed while you had no signal, it opens on your **last known
status** so you can still punch.

If the server turns a saved punch down — for example, the shift was already
closed — the banner shows it with the reason. Check **My timesheet** and use
**Add time** or **Request fix**, or ask your supervisor. Saved punches older
than 72 hours can't be sent.

## Using the kiosk

At the shared tablet at your job site:

1. Enter your 4–6 digit **PIN**, or scan your **QR badge** if your company
   issues them. Tap **Not me — cancel** if the wrong name appears.
2. Pick **Clock in**, **Start break**, **Clock out**, etc.
3. The kiosk confirms what you did. After **Clock out** it also shows the hours
   you've worked today. Tap **Done**, or walk away: the kiosk returns to the
   start screen on its own after 30 seconds.

The kiosk asks the same lunch question as the phone app.

The kiosk does not store your password, and another employee entering their
PIN cannot see your history.

If the kiosk loses its connection it shows **Kiosk offline** with the time you
tried to punch. The punch was **not** recorded: clock in on your phone, or tell
your supervisor the time shown so they can add it.

## Checking your timesheet

Tap **My timesheet** to see the current pay period: each day's entries, daily
totals, weekly overtime and the period totals.

- All times on the timesheet are in your company's timezone. If your phone is
  set to a different zone, the page says which zone it's using.
- Weekly OT is computed under FLSA 40-hour rules. Time off never counts toward
  overtime.
- A shift you haven't clocked out of yet is marked **OPEN**. One the appliance
  closed for you is marked **auto-closed**.
- Tap **History** on an entry to see every change made to it.

### Asking for a fix

If you spot an error in an entry, tap **Request fix**, enter the correct start
and end, and say why. Your supervisor sees it in their queue; the entry
doesn't change until they approve it. The entry shows **fix requested** while
it waits, and you can only have one open request per entry.

The **My requests** section lists your requests with their status (pending,
approved or rejected) and any note from your supervisor.

**Request fix** doesn't appear on approved entries (ask your supervisor) or on
time off (change it in the Grid view).

### Adding time you forgot to punch

On **My timesheet**, tap **+ Add time**. Pick the date, type the time you
clocked in and out, choose a job if your company uses them, and say why.
If the clock-out is earlier than the clock-in, the shift is treated as
running past midnight. Depending on your company's settings it is added
right away, or sent to your supervisor and shows up once they approve it.
You can't add time for a future date or a pay period that's already been
approved.

### Fix it in plain words

If your company has AI corrections on, type the change you want, e.g. "I left
at 5:30 last Tuesday". The app shows exactly what it would change, with the
old and new times, and nothing happens until you confirm. If your company
requires supervisor approval for changes, it tells you to use **Request fix**
instead.

### After approval

Once your supervisor approves a pay period, it's locked: you can't add or
change time in it. Ask your supervisor if something needs correcting.

## Notifications (optional)

- **Email**: your admin has configured this company-wide. You'll get missed-
  punch reminders and weekly summaries if enabled.
- **SMS**: add your phone number under **Notifications** and verify the 6-digit
  code we text you. You can turn email and text messages on or off there for
  each company you work for.

## Privacy

- The app never photographs you and never tracks your location between
  punches.
- If your company turns on **punch location**, your phone is asked for one
  GPS fix at the moment you tap Clock in, Clock out, Start break or End break,
  and that fix is stored with the punch. The My time page tells you when this
  is on. In _optional_ mode you can decline the browser's prompt and your
  punch still goes through, marked "no location". In _required_ mode the app
  will not punch until your phone produces a fix. Kiosk punches never use your
  phone's location.
- It does not identify your device to other employees.
- Your PIN is hashed on the server; even the SuperAdmin cannot read it back.

## Weekly grid

Your **My timesheet** page has a **Grid view** link. Seven days across,
jobs down. Tap any cell to edit or add time. **← List view** takes you back.

- Cell with **PUNCHED** tag → your clock-in/out on that day already
  covers this job. Tap to override; override requires a reason.
- Cell with **MANUAL** tag → a manual entry; tap to edit the number or
  the reason.
- Blank cell with a dash → nothing logged yet. Tap to add.

You can't enter worked hours for a future day. If your company has set
"override only" policy, you'll see a message when you try to add time on a
day+job you didn't actually punch for.

### Logging a day off

On **My timesheet**, tap **+ Time off**, pick the date and type, and enter
the hours. The button appears only if your company lets you record your own
time off. You can also use the Time off rows in the Grid view. Time off can be
entered ahead of time.

If your company records time off, the grid has a **Time off** section
under your jobs (PTO, Sick, Holiday, …). Tap the day and type the
hours, e.g. `8` for a full vacation day. A note is optional. Time off
is never clocked in and out, and it never counts toward overtime. Your
timesheet shows worked hours and time off as separate totals.

If the section says your supervisor records time off for you, ask them
to enter it. Vibe PT doesn't track how much time off you have left;
that stays with your employer's payroll.

### Accepted input formats

Inputs accept any of these styles — the grid auto-detects:

- **Decimal:** `5`, `5.0`, `5.80`, `.5` → hours
- **HH:MM:** `5:48`, `0:30`, `8:00`
- **Labeled:** `5h 48m`, `5hr 48min`, `5 hrs`, `48 min`, `90m`

Rejected inputs tell you why (e.g., "5:60" → "Minutes must be 0–59";
"5 48" → "That's ambiguous — use 5:48 or 5.48").

## Preferences

Tap **Preferences** in the top bar.

- **Time format.** Flip between decimal (7.75) and HH:MM (7:45). My time, My
  timesheet and the grid all follow it. This is a display setting only; it
  never changes the time stored.
- **Password.** Change or set your password. You stay signed in on this
  device; your other devices are signed out.

## Getting help

The **Ask about Vibe PT** button answers questions about using the app. It
can't see or change your time.
