# scripts/

Operational and development scripts for Vibe Payroll Time.

Planned layout:

- `appliance/install.sh` — one-shot Ubuntu 24.04 installer (Phase 1)
- `appliance/update.sh` — appliance upgrade (Phase 1)
- `appliance/backup.sh` — pg_dump + volume snapshot (Phase 1 / 13)
- `dev/` — local developer helpers (resetting DB, seeding demo data, etc.)

Scripts are added as their phase in `BUILD_PLAN.md` is reached.
