# Vibe Payroll Time

A self-hosted, multi-tenant **employee time tracking** appliance for hourly and
shift workers. Designed for CPA firms tracking their own staff hours (free,
internal use) and for CPA firms reselling it to their small-business clients
(commercial tier). Narrower and simpler than QuickBooks Time, OnTheClock, or
Homebase — punch-in/out, timesheet approval, payroll export, nothing more.

**Explicit non-goals (v1):** payroll processing, scheduling, GPS/geofencing,
rate or wage data, native mobile apps, state-specific overtime rules, GL
integration. See [`CLAUDE.md`](./CLAUDE.md) for the full scope.

## Install or update in one line

On a fresh Ubuntu Server 24.04 LTS box (e.g. a GMKtec NucBox M6) **or** an
existing appliance — the same command does both:

```bash
curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/get.sh | sudo bash
```

[`scripts/get.sh`](./scripts/get.sh) detects whether `/opt/vibept/.env`
already exists and routes to the installer or the updater accordingly. On
first run it walks you through the ingress choice (Cloudflare Tunnel /
Tailscale Funnel / public + Caddy), stands up Docker + the stack, and leaves
you at a first-run web wizard for the SuperAdmin. On subsequent runs it takes
a `pg_dump` snapshot, `git pull`s the latest compose / scripts, pulls the
matching GHCR image tag, rolls over the stack, and
auto-rolls-back on health-check failure (only when no migrations ran —
otherwise it prints manual recovery steps).

**Non-interactive install** (pre-answer the ingress prompts):

```bash
curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/get.sh \
  | PROFILE=cloudflare CLOUDFLARE_TUNNEL_TOKEN=xxx sudo -E bash
```

Full list of env-var overrides lives in the header comments of
[`scripts/appliance/install.sh`](./scripts/appliance/install.sh) and
[`scripts/appliance/update.sh`](./scripts/appliance/update.sh).

### Container images

Pre-built images are published to the GitHub Container Registry on every
successful CI run against `main` and every `v*` release tag. Names follow
the Vibe distribution convention (`vibe-distribution-plan.md`):

- `ghcr.io/kisaesdevlab/vibe-payroll-api`
- `ghcr.io/kisaesdevlab/vibe-payroll-web`

Tags:

- `:latest` — most recent release tag
- `:X.Y.Z` / `:X.Y` / `:X` — semver tags on `v*` releases
- `:main` — rolling tip of `main`
- `:sha-<short>` — exact commit, pinnable from `IMAGE_TAG=sha-abc1234` in
  `.env`

`docker-compose.prod.yml` references these paths and pulls them from GHCR;
build from source uses the grouped overlay (see below).

### Compose file conventions

Three compose files cooperate for the dev → grouped → prod lifecycle:

| File                         | Purpose                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docker-compose.yml`         | Dev base — Postgres (+ optional pgAdmin via `--profile tools`) on the host. Backend and frontend run on the host via `npm run dev` for hot reload.                                                                                   |
| `docker-compose.grouped.yml` | Multi-app dev overlay — adds containerized `api` + `web` (built from source), joins the externally-managed `vibe_ingress` network, bakes the `/payroll/` base path into the bundle. Used to test multi-app deployment shape locally. |
| `docker-compose.prod.yml`    | Single-app production — pulls `vibe-payroll-{api,web}` from GHCR, ships its own Caddy ingress, supports the `cloudflare` and `tailscale` tunnel profiles.                                                                            |

## Quick start (dev)

```bash
# boot Postgres
docker compose up -d

# run migrations
npm run migrate --workspace=backend

# start dev servers with hot reload (host process; no container)
npm run dev
```

Backend: <http://localhost:4000/api/v1/health> · Frontend:
<http://localhost:5180>

### Multi-app dev (grouped overlay)

To mirror a multi-app deployment locally:

```bash
docker network create vibe_ingress    # one-time
docker compose -f docker-compose.yml -f docker-compose.grouped.yml up --build -d
```

The `api` + `web` containers join `vibe_ingress` and serve under the
`/payroll/` prefix. Run a Caddy ingress separately in front of
`vibe_ingress` to route to them.

## Documentation

- [`CLAUDE.md`](./CLAUDE.md) — architecture, conventions, and the canonical
  scope document
- [`BUILD_PLAN.md`](./BUILD_PLAN.md) — phased, checklist-driven build plan
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — branching, commits, and PR flow

## Licensing

- Source: [PolyForm Internal Use 1.0.0](./LICENSE) — free for internal
  staff-only use
- Client-portal and reseller use: see
  [`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md)
- Commercial keys vended by the shared
  [`kisaes-license-portal`](https://licensing.kisaes.com)

## Stack

React 18 + Vite + Tailwind + TanStack Query/Table · Node 20 + Express + Knex +
Zod + Pino · PostgreSQL 16 · Docker Compose · Caddy · Cloudflare Tunnel or
Tailscale Funnel.
