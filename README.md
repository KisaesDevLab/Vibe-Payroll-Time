# Vibe Payroll Time

A self-hosted, multi-tenant **employee time tracking** appliance for hourly and
shift workers. Designed for CPA firms tracking their own staff hours (free,
internal use) and for CPA firms reselling it to their small-business clients
(commercial tier). Narrower and simpler than QuickBooks Time, OnTheClock, or
Homebase — punch-in/out, timesheet approval, payroll export, nothing more.

**Explicit non-goals (v1):** payroll processing, scheduling, GPS/geofencing,
rate or wage data, native mobile apps, state-specific overtime rules, GL
integration. See [`CLAUDE.md`](./CLAUDE.md) for the full scope.

## Quick start (dev)

```bash
# boot Postgres + backend + frontend
docker compose -f docker-compose.dev.yml up -d

# run migrations
npm run migrate --workspace=backend

# start dev servers with hot reload
npm run dev
```

Backend: <http://localhost:4000/api/v1/health> · Frontend:
<http://localhost:5173>

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
