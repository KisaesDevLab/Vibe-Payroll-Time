# Deployment

Step-by-step guide for installing Vibe Payroll Time on a GMKtec NucBox M6 (or
equivalent x86_64 mini PC) running Ubuntu Server 24.04 LTS. Any Docker-capable
Linux host will work; the NucBox M6 is the reference hardware Kurt ships.

**Phase coverage:** Phase 1 of `BUILD_PLAN.md`. Expect later phases to tighten
this doc with hardening, backup automation (Phase 13), and licensing ingress
(Phase 12).

---

## 1. Prepare the host

1. Flash Ubuntu Server 24.04 LTS to USB and install on the NucBox with full
   disk encryption. Minimum 250 GB SSD, 8 GB RAM.
2. During install, create a non-root administrator (e.g., `kurt`) and enable
   the OpenSSH server.
3. First-boot hardening:

   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo timedatectl set-timezone America/Chicago     # or your locale
   sudo ufw allow OpenSSH
   # If exposing 80/443 directly (no tunnel):
   sudo ufw allow http && sudo ufw allow https
   sudo ufw --force enable
   sudo apt install -y unattended-upgrades
   sudo dpkg-reconfigure --priority=low unattended-upgrades
   ```

4. (Optional) Disable password SSH once a key is authorized.

## 2. Choose an ingress

Pick one based on your network constraints. You can switch later by
re-running the install script with a different `PROFILE`.

| Profile      | When to use                                                                       |
| ------------ | --------------------------------------------------------------------------------- |
| `public`     | Static public IP, ports 80/443 forwarded, public DNS A record                     |
| `cloudflare` | Appliance sits behind CGNAT or no port forwarding; you own a domain on Cloudflare |
| `tailscale`  | Restricted network or private-only access via Tailscale Funnel                    |

## 3. Install the appliance

SSH into the host and run the installer. It installs Docker Engine, clones
the repo to `/opt/vibept`, generates a `.env` with strong random secrets,
builds images, and brings the stack up.

```bash
curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/appliance/install.sh \
  | sudo PROFILE=cloudflare bash
```

The installer is idempotent. Re-running it updates the checkout and rebuilds.

After install, edit `/opt/vibept/.env`:

- Set `APP_DOMAIN` to the hostname you'll serve (e.g., `pt.example-cpa.com`)
- For `cloudflare` profile: paste `CLOUDFLARE_TUNNEL_TOKEN`
- For `tailscale` profile: paste `TAILSCALE_AUTHKEY`
- Review `JWT_SECRET` and `SECRETS_ENCRYPTION_KEY` — the installer generates
  strong values but you can rotate them before first login

Restart:

```bash
sudo systemctl restart vibept
```

## 4. Verify the stack

```bash
# Containers
docker compose -f /opt/vibept/docker-compose.prod.yml ps

# Backend health
curl -s https://<your-domain>/api/v1/health | jq

# Backend version
curl -s https://<your-domain>/api/v1/version | jq
```

Both endpoints should return JSON with a `data` envelope. The frontend loads
at `https://<your-domain>/`.

On first load the frontend polls `/api/v1/health` and `/api/v1/version` — if
you see red in the home page's "Backend connectivity" card, the backend
container is not healthy. Check `docker logs vibept-backend`.

## 5. Ingress — profile specifics

### Cloudflare Tunnel

1. In the Cloudflare dashboard (<https://dash.cloudflare.com>) → **Networks →
   Connectors → Cloudflare Tunnels**, click **Create a tunnel**, choose
   **Cloudflared** as the connector type, and name it e.g. `vibept-$(hostname)`.
2. On the install step, copy the **token** from the generated `cloudflared ...
   --token <TOKEN>` command into `CLOUDFLARE_TUNNEL_TOKEN` in
   `/opt/vibept/.env`. You run the `cloudflared` process via the bundled
   sidecar — don't install cloudflared on the host.
3. In the tunnel's **Public Hostname** tab, create a route:
   - Subdomain + domain: your public hostname
   - Service: `http://caddy:8080`
4. `sudo systemctl restart vibept`

Cloudflare's edge terminates TLS and forwards to the sidecar over
QUIC — you don't need to open 80/443 on the appliance.

> The token is long-lived and grants control of the tunnel. It's stored
> plaintext in `.env` (chmod 600) — if you rotate it, use the SuperAdmin
> **Appliance Settings → Cloudflare Tunnel** card so the change is applied
> without a manual restart.
>
> Cloudflare docs: <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>

### Tailscale Funnel

1. Generate a reusable, ephemeral auth key at
   <https://login.tailscale.com/admin/settings/keys>.
2. Paste into `TAILSCALE_AUTHKEY` in `/opt/vibept/.env`.
3. The sidecar joins your tailnet with the `tag:vibept-appliance` tag. Funnel
   is automatically configured on :443 forwarding to `http://caddy:8080`.
4. Visit `https://vibept.<your-tailnet>.ts.net` — or use the hostname set in
   `TAILSCALE_HOSTNAME`.

### Direct public

1. Set `APP_DOMAIN` in `/opt/vibept/.env`.
2. Point an A/AAAA record at the appliance's public IP.
3. Uncomment the `{$APP_DOMAIN}` block in `/opt/vibept/caddy/Caddyfile`.
4. `sudo systemctl restart vibept`. Caddy auto-provisions a Let's Encrypt
   certificate on first successful HTTP-01 challenge.

## 6. Day-2 operations

| Task              | Command                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| View logs         | `docker compose -f /opt/vibept/docker-compose.prod.yml logs -f`                      |
| Update appliance  | `sudo /opt/vibept/scripts/appliance/update.sh`                                       |
| Manual backup     | `sudo /opt/vibept/scripts/appliance/backup.sh`                                       |
| Run migrations    | `docker compose -f /opt/vibept/docker-compose.prod.yml exec backend npm run migrate` |
| Open a psql shell | `docker compose -f /opt/vibept/docker-compose.prod.yml exec postgres psql -U vibept` |
| Restart stack     | `sudo systemctl restart vibept`                                                      |
| Stop stack        | `sudo systemctl stop vibept`                                                         |

### Nightly backups

Add the Level 2 backup script to root's crontab:

```bash
sudo crontab -e
# m h dom mon dow command
0 2 * * * /opt/vibept/scripts/appliance/backup.sh >> /var/log/vibept-backup.log 2>&1
```

Dumps land in `/var/backups/vibept/` with 14-day rotation. Off-site copies
(Level 3) and export-everything (Level 4) are added in Phase 13.

## 7. Troubleshooting

### Backend stays unhealthy

`docker logs vibept-backend` — the most common causes:

- `JWT_SECRET must be at least 32 chars` → regenerate with
  `openssl rand -hex 64` and restart.
- `database never became ready` → Postgres is still starting; backend retries
  for 30 seconds. If it persists, check `docker logs vibept-postgres`.
- `invalid environment configuration` → a required `.env` variable is missing
  or malformed.

### TLS fails (direct public profile)

Caddy logs the ACME interaction:

```bash
docker logs vibept-caddy | grep -i acme
```

Make sure:

1. `APP_DOMAIN` resolves to the appliance's public IP.
2. Ports 80 and 443 are reachable from the public internet (`ufw status`,
   router port forward, cloud firewall, etc.).
3. The domain is not held by a prior certificate request still in rate-limit.

### Cloudflare tunnel connects but site is unreachable

Confirm the tunnel's public hostname service is `http://caddy:8080`
(not `localhost` or an IP). The sidecar joins the internal bridge network and
must target the container name.

---

## Next steps

- Phase 2 will add a SuperAdmin setup wizard that runs on first boot when the
  appliance detects no admins exist yet.
- Phase 12 will add licensing enforcement; until then, every company is
  unlicensed but fully functional.
- See `BUILD_PLAN.md` for the full phase list.
