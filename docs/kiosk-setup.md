# Kiosk Setup

A kiosk is a shared tablet that employees use to punch with a PIN. Typical
deployment: one fixed iPad or Android tablet at each job-site entrance or
break room.

## Hardware

| What                                      | Why                                  |
| ----------------------------------------- | ------------------------------------ |
| 10" iPad / Samsung Tab A / Lenovo Tab M10 | Big buttons, easy-to-clean screen    |
| Locking wall mount                        | Prevents walk-off                    |
| Always-on charger                         | Tablets discharge fast in kiosk mode |
| Guided Access / Kiosk Browser             | Keeps employees out of settings      |

## Pairing

1. On your laptop, sign in as a CompanyAdmin.
2. Go to **Kiosks → New pairing code**. Write down the 8-digit code — it
   expires in five minutes.
3. On the tablet, open the appliance URL in Chrome/Safari and add to home
   screen. Launch it.
4. It lands on the kiosk PIN keypad; the first time it boots, tap **Pair this
   device** at the bottom and enter the pairing code.
5. Confirm the device name on the admin screen — it turns green when paired.

The tablet now holds a long-lived device token. **Do not sign in as a user on
this tablet** — the kiosk token is all it needs.

## Day-to-day

- PIN attempts are rate-limited per-device; after five failed attempts the
  keypad locks for two minutes.
- Each PIN lookup is O(1) (no bcrypt per candidate), so even a company of 500
  employees gets an instant lookup.
- Kiosk punches show `source: kiosk` in the audit trail along with the paired
  device's name.

## Locking the tablet

- **iPadOS:** enable **Guided Access** (Settings → Accessibility → Guided
  Access). Triple-click home to start a session pinned to the kiosk app.
- **Android:** set up **Screen Pinning** (Settings → Security → Screen pinning)
  or deploy a dedicated kiosk browser like Kiosk Pro or Scalefusion.

## Retiring a kiosk

1. Admin: **Kiosks → row → Revoke**. The device's token is invalidated on the
   server.
2. On the tablet, clear site data for the appliance URL to wipe the device
   token. (Optional — the server-side revocation is the one that matters.)

## QR badge mode (Phase 4.5)

Any company can flip **Company settings → Punch rules → Kiosk authentication**
to `QR badge only` or `Both`. The tablet re-renders to a camera viewfinder —
no re-pairing required.

### Camera permission

Pairing a tablet for a company in `QR` or `Both` mode triggers a
`getUserMedia` permission prompt as part of the pair flow. Grant it there so
you discover blocked cameras during setup, not at first punch. If it was
denied you'll see "Camera access is blocked" on the scan screen; re-pair or
open site settings to grant access.

### Recommended tablets

- Any iPad from 2019 onward — front camera, browser `getUserMedia` support.
- Amazon Fire HD 10 (9th gen+) with Silk or Firefox — cheap, good-enough
  camera for high-contrast QR.
- Samsung Galaxy Tab A / A8 — well-supported, inexpensive, fine camera.
- Desktops and Chromebooks with USB webcams also work; any webcam that
  produces ≥ VGA-quality video is fine.

### Printing badges

From **Employees** page: tick the rows you want, click **Issue badges for N…**.
A new browser tab opens with the print sheet (Avery 5392-sized 2-up layout).
Use the browser's Save-as-PDF or Print dialog.

For a single employee: open the employee drawer → **Issue badge**. The modal
shows the QR on-screen with a Download PNG button; dismissing it is
non-recoverable, so save or print first.

**Laminate vs. bare paper:** printed cardstock + clear 3mil lamination tolerates
a shift's worth of pocket wear. Bare paper works for 1-2 weeks; credential
holders help. Badges use level-H QR error correction, so a small smudge or
crease won't break scanning.

### Revoking a lost badge

**Employees → row → Badge panel → Revoke.** The printed card stops scanning
the next attempt. Reissuing on the same employee generates a new `vN+1` badge —
any older card (including the revoked one) is rejected at the kiosk with an
amber "Badge is no longer active" toast.
