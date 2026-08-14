# Troubleshooting

## "Pending migrations" on the health check

Migrations run automatically on boot when `MIGRATE_ON_BOOT=true` (the
default). If `/api/v1/health/ready` reports pending migrations after a
restart:

```bash
docker compose -f /opt/vibept/docker-compose.prod.yml exec api \
  npm run migrate --workspace=backend
```

Then re-run the health check.

## Backend boots but employees see a blank page

Open the browser devtools → Network tab → filter on `/api/v1/`. If requests
fail with CORS errors, your `CORS_ORIGIN` in `.env` does not match the URL
users actually see. Edit `.env` and `docker compose restart api`.

## "Too many requests" on the kiosk

Per-device rate limit kicked in. Wait two minutes or unlock via **Kiosks →
row → Unlock**. Repeated trips usually indicate a shared PIN — assign each
employee their own.

## Scheduled cron jobs not firing

Every cron logs to stdout on start-up:

```
vibept-api | auto-clockout sweep scheduled (every 5 minutes)
vibept-api | retention sweep scheduled (03:41 UTC daily)
```

Missing a line usually means the api crashed on boot — `docker compose
logs api | tail -50`.

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

## AI features are down and the log repeats "vibe-ai-router task-class registration failed; will retry"

An endless retry loop (warn lines with a growing `attempt`) is almost always
an App token minted for the wrong identity — it must be exactly
`vibe-payroll-time` (older router docs said `vibe-payroll`). The router 403s
registration and the failure is otherwise silent: AI menus render, but every
request fails closed. The **AI Router** card on the SuperAdmin **Appliance**
dashboard shows the same thing without log access — a red "registration
failing" with `HTTP 403` and the token-identity hint.

Fix: mint a token for the exact identity in the router console, update
`VIBE_AI_TOKEN` in `.env`, `docker compose restart api`, and confirm the
`vibe-ai-router task classes registered` line appears on the **first**
attempt. Secondary cause: `VIBE_AI_ROUTER_URL` unreachable from the api
container. See `docs/ai-router.md`.

## AI requests return 502/503 in router mode

The router is down or unreachable. There is **by design no fallback** to a
direct provider — that would route prompts around the router's scrubber and
ledger. Restore the router (check its container logs) rather than looking
for an app-side workaround.

## NL corrections fail but the support chat works

Capability gate: the model the router policy assigned to
`payroll_nl_correction` does not support tool calling. Assign a
tools-capable local model in the router console (the Ollama capability probe
must show `tools: true`; `qwen3` works). See `docs/ai-router.md`.

## Restore drill

See `docs/restore.md` for the step-by-step. Run it quarterly against a
disposable copy of production to verify backups.

## When to open an issue

If you've been through this page and the health check is still red, open
an issue at **github.com/KisaesDevLab/Vibe-Payroll-Time/issues** with:

- The output of `docker compose ps`
- The last 100 lines of `docker compose logs api`
- The output of `curl -s http://localhost:4000/api/v1/health/ready | jq`
- The git SHA reported by `/api/v1/version`
