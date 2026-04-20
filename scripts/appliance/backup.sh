#!/usr/bin/env bash
# Vibe Payroll Time — Level 2 backup (see BUILD_PLAN.md Phase 13).
#
# Runs a logical pg_dump of the appliance database and rotates on-disk
# backups. Intended to be invoked from cron nightly:
#
#   0 2 * * * /opt/vibept/scripts/appliance/backup.sh >> /var/log/vibept-backup.log 2>&1
#
# WAL archiving (Level 1), off-site weekly (Level 3), and export-everything
# (Level 4) are added in Phase 13.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vibept}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="${COMPOSE_FILE:-$INSTALL_DIR/docker-compose.prod.yml}"

log()  { printf '\033[1;34m[backup]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[backup]\033[0m %s\n' "$*" >&2; }

if [[ ! -f "$COMPOSE_FILE" ]]; then
  err "compose file not found: $COMPOSE_FILE"
  exit 1
fi

# Source .env so we have POSTGRES_USER / POSTGRES_DB.
if [[ -f "$INSTALL_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$INSTALL_DIR/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-vibept}"
POSTGRES_DB="${POSTGRES_DB:-vibept}"

mkdir -p "$BACKUP_DIR"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/vibept-$stamp.sql.gz"

log "dumping $POSTGRES_DB to $target"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --no-owner --no-acl --clean --if-exists \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  | gzip -9 > "$target"

size=$(du -h "$target" | cut -f1)
log "dump complete ($size)"

log "pruning backups older than $RETENTION_DAYS day(s)"
find "$BACKUP_DIR" -maxdepth 1 -name 'vibept-*.sql.gz' -type f \
  -mtime +"$RETENTION_DAYS" -print -delete || true

log "backup done"
