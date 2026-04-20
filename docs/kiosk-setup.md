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
