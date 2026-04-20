# Troubleshooting

## "Pending migrations" on the health check

Migrations run automatically on boot when `MIGRATE_ON_BOOT=true` (the
default). If `/api/v1/health/ready` reports pending migrations after a
restart:

```bash
docker compose -f /opt/vibept/docker-compose.prod.yml exec backend \
  npm run migrate --workspace=backend
```

Then re-run the health check.

## Backend boots but employees see a blank page

Open the browser devtools → Network tab → filter on `/api/v1/`. If requests
fail with CORS errors, your `CORS_ORIGIN` in `.env` does not match the URL
users actually see. Edit `.env` and `docker compose restart backend`.

## "Too many requests" on the kiosk

Per-device rate limit kicked in. Wait two minutes or unlock via **Kiosks →
row → Unlock**. Repeated trips usually indicate a shared PIN — assign each
employee their own.

## Scheduled cron jobs not firing

Every cron logs to stdout on start-up:

```
vibept-backend | auto-clockout sweep scheduled (every 5 minutes)
vibept-backend | retention sweep scheduled (03:41 UTC daily)
```

Missing a line usually means the backend crashed on boot — `docker compose
logs backend | tail -50`.

## Export downloads an empty CSV

Preflight is your friend. It tells you which employees are missing payroll
codes and which days haven't been approved. An empty CSV almost always means
either (a) no approved hours in the selected window, or (b) every employee
is missing their external payroll ID.

## Kiosk won't pair — "pairing code not found"

Codes expire after five minutes. Generate a fresh one from the admin UI. If
the problem persists, the tablet's clock may be off by more than five
minutes — put it on Wi-Fi with NTP enabled.

## SMS sends fail

Under **Notifications → Log**, failed rows show the Twilio error code. The
top three:

- **21211**: invalid "to" number. The employee entered a malformed phone.
- **21610**: recipient replied STOP. They must text START back to re-enable.
- **20003**: authentication failed. The Auth Token is wrong — re-save under
  **Settings → SMS** and the appliance re-encrypts it.

## License upload says `license_bad_signature`

The JWT was not signed by the public key configured via
`LICENSE_PUBKEY_PEM`. Either you pasted a dev-generated JWT against a prod
public key, or the portal rotated its signing key — request a fresh JWT from
`licensing.kisaes.com`.

## Restore drill

See `docs/restore.md` for the step-by-step. Run it quarterly against a
disposable copy of production to verify backups.

## When to open an issue

If you've been through this page and the health check is still red, open
an issue at **github.com/KisaesDevLab/Vibe-Payroll-Time/issues** with:

- The output of `docker compose ps`
- The last 100 lines of `docker compose logs backend`
- The output of `curl -s http://localhost:4000/api/v1/health/ready | jq`
- The git SHA reported by `/api/v1/version`
