#!/usr/bin/env bash
# Vibe Payroll Time — appliance updater.
#
# Pulls the latest source, rebuilds images, applies pending migrations, and
# restarts the stack. Safe to run repeatedly; no-op if already up to date.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BRANCH="${BRANCH:-main}"
PROFILE="${PROFILE:-public}"

log()  { printf '\033[1;34m[update]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[update]\033[0m %s\n' "$*" >&2; }

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  err "no checkout at $INSTALL_DIR; run install.sh first"
  exit 1
fi

cd "$INSTALL_DIR"

log "fetching latest source"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only

log "rebuilding images"
docker compose -f docker-compose.prod.yml --profile "$PROFILE" build

log "bringing stack up"
docker compose -f docker-compose.prod.yml --profile "$PROFILE" up -d

# The backend runs migrations on boot (MIGRATE_ON_BOOT=true by default) so a
# re-up is sufficient. Explicit migration is exposed for operators who want to
# run it out of band:
#   docker compose -f docker-compose.prod.yml exec backend npm run migrate

log "update complete"
