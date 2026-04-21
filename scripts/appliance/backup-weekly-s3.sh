#!/usr/bin/env bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
# Vibe Payroll Time — Level 3 backup (see BUILD_PLAN.md Phase 13).
#
# Ships the most recent nightly Level-2 pg_dump, the WAL archive directory,
# and the appliance .env (encrypted separately — see docs/security.md) to
# an S3-compatible destination via rclone. Intended to be invoked from cron
# weekly:
#
#   17 3 * * 0 /opt/vibept/scripts/appliance/backup-weekly-s3.sh \
#     >> /var/log/vibept-backup-s3.log 2>&1
#
# Requires:
#   - rclone installed on the host
#   - a preconfigured rclone remote, name set in RCLONE_REMOTE (e.g. "s3:vibept-backups")
#   - Level-2 backups present in $BACKUP_DIR (backup.sh run nightly first)
#
# Retention is handled server-side by the S3 lifecycle policy; this script
# never deletes remote objects.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vibept}"
WAL_DIR="${WAL_DIR:-/var/backups/vibept-wal}"

log() { printf '\033[1;34m[backup-s3]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[backup-s3]\033[0m %s\n' "$*" >&2; }

if [[ -f "$INSTALL_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$INSTALL_DIR/.env"
  set +a
fi

RCLONE_REMOTE="${RCLONE_REMOTE:-}"
APPLIANCE_ID="${APPLIANCE_ID:-unknown}"

if [[ -z "$RCLONE_REMOTE" ]]; then
  err "RCLONE_REMOTE not set; refusing to run. Configure rclone and set RCLONE_REMOTE=<remote:bucket/path>."
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  err "rclone not installed. See docs/deployment.md §Backup for setup."
  exit 1
fi

latest_dump=$(find "$BACKUP_DIR" -maxdepth 1 -name 'vibept-*.sql.gz' -type f -printf '%T@ %p\n' 2>/dev/null \
  | sort -nr | head -n1 | awk '{print $2}')

if [[ -z "$latest_dump" ]]; then
  err "no Level-2 dumps found in $BACKUP_DIR — run backup.sh nightly before this job."
  exit 1
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dest="$RCLONE_REMOTE/$APPLIANCE_ID/$stamp"

log "uploading latest dump: $latest_dump -> $dest/"
rclone copy --no-traverse "$latest_dump" "$dest/" --s3-storage-class=STANDARD_IA

if [[ -d "$WAL_DIR" ]] && [[ -n "$(ls -A "$WAL_DIR" 2>/dev/null)" ]]; then
  log "uploading WAL archive: $WAL_DIR -> $dest/wal/"
  rclone copy "$WAL_DIR" "$dest/wal/" --s3-storage-class=STANDARD_IA
else
  log "no WAL archive at $WAL_DIR (archive mode may be off); skipping"
fi

log "weekly S3 backup complete"
