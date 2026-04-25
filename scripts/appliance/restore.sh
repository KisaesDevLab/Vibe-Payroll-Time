#!/usr/bin/env bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
# Vibe Payroll Time — restore a Level-2 backup into a fresh Postgres.
#
# Usage:
#   ./scripts/appliance/restore.sh <path-to-dump.sql.gz>
#
# The script STOPS the api + web + caddy services while the
# database is being rewritten, drops the public schema, restores, and
# restarts everything. Intended for use during a restore drill or real
# recovery. WAL-based PITR is a manual procedure — see docs/restore.md.
#
# WARNING: this is destructive. You will lose any data in the current
# database. Confirmation is required unless FORCE=1 is set.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
COMPOSE_FILE="${COMPOSE_FILE:-$INSTALL_DIR/docker-compose.prod.yml}"

log() { printf '\033[1;34m[restore]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[restore]\033[0m %s\n' "$*" >&2; }

if [[ $# -lt 1 ]]; then
  err "usage: $0 <dump.sql.gz>"
  exit 1
fi

DUMP="$1"

if [[ ! -f "$DUMP" ]]; then
  err "dump file not found: $DUMP"
  exit 1
fi

if [[ -f "$INSTALL_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$INSTALL_DIR/.env"
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-vibept}"
POSTGRES_DB="${POSTGRES_DB:-vibept}"

if [[ "${FORCE:-0}" != "1" ]]; then
  printf 'About to OVERWRITE database "%s" from %s.\nType "yes" to proceed: ' "$POSTGRES_DB" "$DUMP"
  read -r answer
  [[ "$answer" == "yes" ]] || { err "aborted"; exit 1; }
fi

log "stopping api + web + caddy"
docker compose -f "$COMPOSE_FILE" stop api web caddy || true

log "dropping and recreating public schema"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
SQL

log "restoring from $DUMP"
gunzip -c "$DUMP" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"

log "starting services back up"
# The api container honors MIGRATE_ON_BOOT (true by default), so any
# migrations that postdate the dump apply automatically once it boots.
# Caddy must come up too in case the operator points a browser at the
# health endpoint to verify.
docker compose -f "$COMPOSE_FILE" up -d api web caddy

log "restore complete. verify at the health endpoint."
log "if the dump predates current migrations, the api applies them on boot"
log "(MIGRATE_ON_BOOT=true). watch \`docker logs vibept-api\` to confirm."
