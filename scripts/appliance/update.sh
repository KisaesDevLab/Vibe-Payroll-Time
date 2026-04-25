#!/usr/bin/env bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
# Vibe Payroll Time — appliance updater.
#
# Safe, idempotent update flow:
#   1. Read PROFILE from /opt/vibept/.env (written by install.sh).
#   2. Capture rollback state: git SHA, current image digests, migration count.
#   3. Run scripts/appliance/backup.sh (pg_dump). Abort if it fails.
#   4. git pull, docker compose pull, docker compose up -d.
#      (Prod is image-pull only — no `build:` directives, so the new tag
#       comes from GHCR and `up -d` recreates the api+web containers.)
#   5. Wait up to HEALTH_TIMEOUT_SECONDS for the api to report healthy.
#   6. On success: exit 0.
#      On failure AND no migrations ran: auto-rollback to pre-update git SHA
#        and pre-update image digests, then up -d again.
#      On failure AND migrations ran: print manual recovery steps and exit 1 —
#        auto-rollback is unsafe when the DB schema has moved forward.
#
# Usage (as root):
#   sudo bash /opt/vibept/scripts/appliance/update.sh
#
# Env-var overrides:
#   INSTALL_DIR                [/opt/vibept]
#   BRANCH                     [main]
#   PROFILE                    override .env (public|cloudflare|tailscale)
#   IMAGE_TAG                  override .env (default: latest)
#   HEALTH_TIMEOUT_SECONDS     [120]
#   SKIP_BACKUP=1              skip pg_dump before updating (NOT RECOMMENDED)

set -euo pipefail

# ---------- config ----------
INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.prod.yml"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"
SKIP_BACKUP="${SKIP_BACKUP:-}"

# Populated during the run.
PROFILE="${PROFILE:-}"
IMAGE_TAG="${IMAGE_TAG:-}"
API_IMAGE=""
WEB_IMAGE=""
PRE_SHA=""
PRE_API_ID=""
PRE_WEB_ID=""
PRE_MIGRATION_COUNT=""

# ---------- output helpers ----------
_tty() { [[ -t 1 ]] && printf '%s' "$1" || true; }
log()  { printf '%s[update]%s %s\n'  "$(_tty $'\033[1;34m')" "$(_tty $'\033[0m')" "$*"; }
warn() { printf '%s[update]%s %s\n'  "$(_tty $'\033[1;33m')" "$(_tty $'\033[0m')" "$*" >&2; }
err()  { printf '%s[update]%s %s\n'  "$(_tty $'\033[1;31m')" "$(_tty $'\033[0m')" "$*" >&2; }
ok()   { printf '%s[update]%s %s\n'  "$(_tty $'\033[1;32m')" "$(_tty $'\033[0m')" "$*"; }

banner() {
  local line='============================================================'
  printf '\n%s%s%s\n%s%s%s\n%s%s%s\n\n' \
    "$(_tty $'\033[1m')" "$line" "$(_tty $'\033[0m')" \
    "$(_tty $'\033[1m')" "$1"   "$(_tty $'\033[0m')" \
    "$(_tty $'\033[1m')" "$line" "$(_tty $'\033[0m')"
}

# ---------- guards ----------
require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "must be run as root (use sudo)"
    exit 1
  fi
}

check_install_dir() {
  if [[ ! -d "$INSTALL_DIR/.git" ]]; then
    err "no checkout at $INSTALL_DIR — run install.sh first"
    exit 1
  fi
  if [[ ! -f $COMPOSE_FILE ]]; then
    err "compose file missing: $COMPOSE_FILE"
    exit 1
  fi
}

# ---------- env parsing ----------
# env_value KEY — echoes the raw value of KEY= from .env (last wins), else empty.
env_value() {
  local key="$1" line
  [[ -f "$INSTALL_DIR/.env" ]] || { echo ""; return; }
  line=$(grep -E "^${key}=" "$INSTALL_DIR/.env" 2>/dev/null | tail -1 || true)
  [[ -z $line ]] && { echo ""; return; }
  # Strip "KEY=" prefix and any trailing \r from editors that like CRLF.
  local value="${line#"${key}"=}"
  value="${value%$'\r'}"
  echo "$value"
}

resolve_profile() {
  if [[ -z $PROFILE ]]; then
    PROFILE=$(env_value PROFILE)
  fi
  if [[ -z $PROFILE ]]; then
    err "PROFILE not found in $INSTALL_DIR/.env"
    err "either rerun install.sh (which writes PROFILE=), or set PROFILE=public|cloudflare|tailscale"
    exit 1
  fi
  case "$PROFILE" in
    public|cloudflare|tailscale) ;;
    *) err "invalid PROFILE='$PROFILE' (want: public|cloudflare|tailscale)"; exit 1 ;;
  esac
}

resolve_image_tag() {
  if [[ -z $IMAGE_TAG ]]; then
    IMAGE_TAG=$(env_value IMAGE_TAG)
  fi
  [[ -z $IMAGE_TAG ]] && IMAGE_TAG=latest
  API_IMAGE="ghcr.io/kisaesdevlab/vibe-payroll-api:$IMAGE_TAG"
  WEB_IMAGE="ghcr.io/kisaesdevlab/vibe-payroll-web:$IMAGE_TAG"
}

# Older .env files (pre-Caddyfile-split) lack CADDYFILE_PATH. Public-profile
# customers used to manually uncomment a block in caddy/Caddyfile; that file
# is now tunnel-only and a dedicated caddy/Caddyfile.public lives alongside.
# Without this backfill, an existing public-profile install upgrading past
# the split would `git pull` the tunnel-only Caddyfile and lose direct
# public ingress until someone hand-edited .env. Run this once on update;
# it's a no-op for tunnel profiles or any .env that already sets the var.
backfill_caddyfile_path() {
  local env_path="$INSTALL_DIR/.env"
  [[ -f $env_path ]] || return 0
  if grep -qE '^CADDYFILE_PATH=' "$env_path"; then
    return 0
  fi
  if [[ "$PROFILE" == "public" ]]; then
    log "backfilling CADDYFILE_PATH=./caddy/Caddyfile.public into $env_path"
    printf '\n# Backfilled on %s by update.sh: route public-profile traffic\n# through the dedicated Caddyfile.public.\nCADDYFILE_PATH=./caddy/Caddyfile.public\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$env_path"
  fi
}

# ---------- migration count (authoritative, via postgres directly) ----------
migration_count() {
  local user db
  user=$(env_value POSTGRES_USER); [[ -z $user ]] && user=vibept
  db=$(env_value POSTGRES_DB);     [[ -z $db ]]   && db=vibept
  docker exec vibept-postgres psql -U "$user" -d "$db" -t -A \
    -c "SELECT count(*) FROM knex_migrations" 2>/dev/null | tr -d '[:space:]'
}

# ---------- rollback state ----------
capture_rollback_state() {
  PRE_SHA=$(git -C "$INSTALL_DIR" rev-parse HEAD)
  log "pre-update git SHA: $PRE_SHA"

  PRE_API_ID=$(docker image inspect --format '{{.Id}}' "$API_IMAGE" 2>/dev/null || echo "")
  PRE_WEB_ID=$(docker image inspect --format '{{.Id}}' "$WEB_IMAGE" 2>/dev/null || echo "")

  # Pin them under a stable rollback tag so nothing else can prune them
  # during the update window. Overwrites any previous rollback-previous tag.
  if [[ -n $PRE_API_ID ]]; then
    docker tag "$PRE_API_ID" vibept-rollback-api:previous >/dev/null
  else
    warn "no current api image found for $API_IMAGE (auto-rollback disabled)"
  fi
  if [[ -n $PRE_WEB_ID ]]; then
    docker tag "$PRE_WEB_ID" vibept-rollback-web:previous >/dev/null
  else
    warn "no current web image found for $WEB_IMAGE (auto-rollback disabled)"
  fi

  PRE_MIGRATION_COUNT=$(migration_count || echo "")
  if [[ -z $PRE_MIGRATION_COUNT ]]; then
    warn "could not read pre-update migration count (postgres not reachable?)"
    warn "auto-rollback will be conservative and refuse to run if DB is modified"
    PRE_MIGRATION_COUNT="?"
  else
    log "pre-update migration count: $PRE_MIGRATION_COUNT"
  fi
}

# ---------- pre-update backup ----------
run_backup() {
  if [[ -n $SKIP_BACKUP ]]; then
    warn "SKIP_BACKUP set — skipping pre-update backup (not recommended)"
    return
  fi
  local backup_script="$INSTALL_DIR/scripts/appliance/backup.sh"
  if [[ ! -f $backup_script ]]; then
    err "backup.sh not found at $backup_script — refusing to update without a backup"
    err "set SKIP_BACKUP=1 to override (you will have no rollback point on migration failure)"
    exit 1
  fi
  log "running pre-update backup"
  if ! bash "$backup_script"; then
    err "pre-update backup failed — refusing to proceed"
    exit 1
  fi
  ok "backup complete"
}

# ---------- update steps ----------
fetch_source() {
  log "fetching latest source on $BRANCH"
  (
    cd "$INSTALL_DIR"
    git fetch --all --prune
    git checkout "$BRANCH"
    git pull --ff-only
  )
  local new_sha
  new_sha=$(git -C "$INSTALL_DIR" rev-parse HEAD)
  if [[ $new_sha == "$PRE_SHA" ]]; then
    log "already up to date — no source changes"
  else
    log "git moved $PRE_SHA → $new_sha"
  fi
}

# docker-compose.prod.yml is image-pull only — pull the new tag from GHCR
# and let `up -d` recreate containers when the digest changes. Build args
# do not apply on the appliance; CI bakes APP_VERSION / GIT_SHA / BUILD_DATE
# into the published image at release time.
pull_images() {
  log "pulling images for profile '$PROFILE'"
  if ! (cd "$INSTALL_DIR" && docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" pull); then
    err "image pull failed — rolling back source checkout so git state matches running containers"
    git -C "$INSTALL_DIR" reset --hard "$PRE_SHA"
    err "exit 1: previous containers are still running; no data affected"
    exit 1
  fi
}

bring_up() {
  log "recreating containers"
  (cd "$INSTALL_DIR" && docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" up -d)
}

# ---------- health wait ----------
wait_for_health() {
  local iters=$((HEALTH_TIMEOUT_SECONDS / 2))
  [[ $iters -lt 1 ]] && iters=1
  log "waiting up to ${HEALTH_TIMEOUT_SECONDS}s for api to report healthy"
  local status
  for _ in $(seq 1 "$iters"); do
    status=$(docker inspect --format '{{.State.Health.Status}}' vibept-api 2>/dev/null || echo "absent")
    if [[ $status == healthy ]]; then
      ok "api healthy"
      return 0
    fi
    sleep 2
  done
  return 1
}

# ---------- rollback ----------
rollback() {
  err "api failed to become healthy within ${HEALTH_TIMEOUT_SECONDS}s"
  local post_count
  post_count=$(migration_count || echo "?")
  log "post-update migration count: $post_count (pre-update was $PRE_MIGRATION_COUNT)"

  # Auto-rollback only if we're sure migrations didn't move forward.
  if [[ $PRE_MIGRATION_COUNT == "?" || $post_count == "?" || $post_count != "$PRE_MIGRATION_COUNT" ]]; then
    err "DB schema moved forward or couldn't be verified — auto-rollback is UNSAFE"
    err "the old code would not be able to read the migrated schema."
    err ""
    err "manual recovery options:"
    err "  A) FORWARD FIX — inspect the failure and push a fix"
    err "       docker compose -f $COMPOSE_FILE --profile $PROFILE logs --tail=200 api"
    err ""
    err "  B) RESTORE — roll the DB back to before this update, then revert code"
    err "       $INSTALL_DIR/scripts/appliance/restore.sh    # pick the most recent dump"
    err "       git -C $INSTALL_DIR reset --hard $PRE_SHA"
    err "       $INSTALL_DIR/scripts/appliance/update.sh     # rebuild & restart pre-update version"
    err ""
    err "  Previous image digests preserved as:"
    err "       vibept-rollback-api:previous  (was $API_IMAGE)"
    err "       vibept-rollback-web:previous  (was $WEB_IMAGE)"
    exit 1
  fi

  if [[ -z $PRE_API_ID && -z $PRE_WEB_ID ]]; then
    err "no pre-update image digests captured — cannot auto-rollback"
    err "  git -C $INSTALL_DIR reset --hard $PRE_SHA"
    err "  $INSTALL_DIR/scripts/appliance/update.sh"
    exit 1
  fi

  warn "no migrations ran — attempting automatic rollback"
  git -C "$INSTALL_DIR" reset --hard "$PRE_SHA"
  if [[ -n $PRE_API_ID ]]; then
    docker tag "$PRE_API_ID" "$API_IMAGE" >/dev/null
  fi
  if [[ -n $PRE_WEB_ID ]]; then
    docker tag "$PRE_WEB_ID" "$WEB_IMAGE" >/dev/null
  fi
  (cd "$INSTALL_DIR" && docker compose -f "$COMPOSE_FILE" --profile "$PROFILE" up -d)
  if wait_for_health; then
    warn "rollback succeeded — appliance is back on git $PRE_SHA"
    warn "update did not land; inspect logs before retrying"
    exit 1
  fi
  err "rollback also failed health check — manual intervention required"
  err "  docker compose -f $COMPOSE_FILE --profile $PROFILE logs --tail=200 api"
  exit 1
}

# ---------- main ----------
main() {
  require_root
  banner "Vibe Payroll Time — Appliance Updater"

  check_install_dir
  resolve_profile
  resolve_image_tag
  log "profile: $PROFILE, image tag: $IMAGE_TAG"

  capture_rollback_state
  run_backup
  fetch_source
  # Backfill must come AFTER fetch_source so the new caddy/Caddyfile.public
  # exists on disk by the time `bring_up` mounts it.
  backfill_caddyfile_path
  pull_images
  bring_up

  if wait_for_health; then
    banner "Update complete"
    cat <<EOF
  API:     healthy
  Git SHA: $(git -C "$INSTALL_DIR" rev-parse HEAD)
  Profile: $PROFILE

  Pre-update image digests preserved under:
    vibept-rollback-api:previous
    vibept-rollback-web:previous
  (used for auto-rollback on the next failed update; overwritten each run)

  Tail logs:  docker compose -f $COMPOSE_FILE --profile $PROFILE logs -f
EOF
  else
    rollback
  fi
}

main "$@"
