#!/usr/bin/env bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
# Host-side wrapper invoked by vibept-updater.service when the backend
# container drops update-control/request.json. Responsibilities:
#
#   1. Announce start (status=running) so the UI poller sees us.
#   2. Tee update.sh output to update-control/log.txt so the UI can tail it.
#   3. Write the final outcome to status.json.
#   4. Remove request.json so the path unit can trigger again later.
#
# Idempotent: if request.json is missing (race / double-trigger), exit 0.

set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
CTRL_DIR="$INSTALL_DIR/update-control"
REQUEST_FILE="$CTRL_DIR/request.json"
LOG_FILE="$CTRL_DIR/log.txt"
STATUS_FILE="$CTRL_DIR/status.json"
UPDATE_SH="$INSTALL_DIR/scripts/appliance/update.sh"

# Minimal JSON writer — no jq dependency. Escapes backslashes + quotes only;
# we never write user-controlled strings here, just timestamps and SHAs.
write_status() {
  local state="$1" outcome="${2:-}" message="${3:-}" pre_sha="${4:-}" post_sha="${5:-}"
  cat > "$STATUS_FILE" <<JSON
{
  "state": "$state",
  "outcome": "$outcome",
  "message": "$message",
  "pre_sha": "$pre_sha",
  "post_sha": "$post_sha",
  "updated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
}

# If someone removed the request file between path trigger and us, exit clean.
if [[ ! -f "$REQUEST_FILE" ]]; then
  exit 0
fi

mkdir -p "$CTRL_DIR"

# Fresh log per run.
: > "$LOG_FILE"

PRE_SHA=$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")

write_status running "" "update in progress" "$PRE_SHA" ""

if [[ ! -x "$UPDATE_SH" && ! -f "$UPDATE_SH" ]]; then
  write_status finished failed "updater script not found at $UPDATE_SH" "$PRE_SHA" "$PRE_SHA"
  rm -f "$REQUEST_FILE"
  exit 1
fi

# Run update.sh with output tee'd to log.txt. `bash` invocation keeps us
# independent of the exec bit, which may or may not survive git checkout
# on some filesystems.
set -o pipefail
if bash "$UPDATE_SH" 2>&1 | tee -a "$LOG_FILE"; then
  rc=0
else
  rc=${PIPESTATUS[0]}
fi
set +o pipefail

POST_SHA=$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")

if [[ $rc -eq 0 ]]; then
  write_status finished success "update complete" "$PRE_SHA" "$POST_SHA"
else
  write_status finished failed "update.sh exited with $rc (see log.txt)" "$PRE_SHA" "$POST_SHA"
fi

# Remove the request file so the path unit can fire again on the next click.
rm -f "$REQUEST_FILE"

exit "$rc"
