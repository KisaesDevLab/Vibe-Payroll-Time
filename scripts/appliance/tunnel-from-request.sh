#!/usr/bin/env bash
# Host-side applier invoked by vibept-tunnel.service when the backend
# container drops update-control/tunnel-request.json. Responsibilities:
#
#   1. Parse the request JSON (token_action, target_enabled, optional token).
#   2. Update .env in place (SEED_DEMO_ON_BOOT-style sed swap) for
#      CLOUDFLARE_TUNNEL_TOKEN if the token_action is set/clear.
#   3. Bring the cloudflare compose profile up or down based on
#      target_enabled.
#   4. Write tunnel-status.json with {state, applied_at, error?}.
#   5. Delete the request file last so the path unit can retrigger.
#
# Security:
#   - Runs as root (systemd unit). Only writes to .env and tunnel-status.json.
#   - The request file contains plaintext token when set/rotated. It's
#     deleted after apply. Containing dir (update-control/) is chmod 700
#     at install time.
#
# Idempotent: if the request file is missing between path trigger and us,
# exit 0.

set -uo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
CTRL_DIR="$INSTALL_DIR/update-control"
REQUEST_FILE="$CTRL_DIR/tunnel-request.json"
STATUS_FILE="$CTRL_DIR/tunnel-status.json"
ENV_FILE="$INSTALL_DIR/.env"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.prod.yml"

write_status() {
  local state="$1" error="${2:-}"
  local escaped_error
  # JSON-escape the error string — backslashes and double quotes only;
  # we never have newlines in our error messages.
  escaped_error=$(printf '%s' "$error" | sed 's/\\/\\\\/g; s/"/\\"/g')
  cat > "$STATUS_FILE" <<JSON
{
  "state": "$state",
  "applied_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "error": "$escaped_error"
}
JSON
}

fail() {
  write_status failed "$1"
  rm -f "$REQUEST_FILE"
  exit 1
}

if [[ ! -f "$REQUEST_FILE" ]]; then
  exit 0
fi

mkdir -p "$CTRL_DIR"
write_status running ""

# Minimal JSON extraction — avoids a jq dependency. Cloudflared tokens
# are base64url-ish so `[^"]+` captures them cleanly without needing to
# unescape anything. If that assumption ever changes, add jq to the
# appliance baseline and swap these for `jq -r`.
token_action=$(sed -nE 's/.*"token_action"\s*:\s*"([^"]+)".*/\1/p' "$REQUEST_FILE" | head -1)
target_enabled=$(sed -nE 's/.*"target_enabled"\s*:\s*(true|false).*/\1/p' "$REQUEST_FILE" | head -1)
token_value=""
if [[ $token_action == "set" ]]; then
  token_value=$(sed -nE 's/.*"token"\s*:\s*"([^"]+)".*/\1/p' "$REQUEST_FILE" | head -1)
fi

if [[ -z $target_enabled ]]; then
  fail "missing target_enabled in request"
fi
if [[ -z $token_action ]]; then
  fail "missing token_action in request"
fi

# ---- .env mutation ----
upsert_env_var() {
  local key="$1" value="$2"
  # Escape for sed — forward slash, ampersand, backslash.
  local escaped
  escaped=$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')
  if grep -qE "^${key}=" "$ENV_FILE"; then
    sed -i -E "s|^${key}=.*$|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

case "$token_action" in
  set)
    if [[ -z $token_value ]]; then
      fail "token_action=set but no token value present"
    fi
    upsert_env_var CLOUDFLARE_TUNNEL_TOKEN "$token_value"
    ;;
  clear)
    upsert_env_var CLOUDFLARE_TUNNEL_TOKEN ""
    ;;
  keep)
    : # leave .env alone
    ;;
  *)
    fail "unknown token_action: $token_action"
    ;;
esac

chmod 600 "$ENV_FILE" || true

# Scrub the plaintext token from the request file before we proceed —
# even though we delete the whole file at the end, shrinking the
# on-disk lifetime of the secret by another few seconds is free.
if [[ $token_action == set ]]; then
  : > "$REQUEST_FILE"
fi

# ---- docker compose profile apply ----
if ! command -v docker >/dev/null 2>&1; then
  fail "docker not on PATH"
fi

if [[ $target_enabled == "true" ]]; then
  # Bring the cloudflare profile up. If it's already running, `up -d`
  # with the restart:unless-stopped image means a new token triggers a
  # container restart automatically (compose detects the env change).
  if ! docker compose -f "$COMPOSE_FILE" --profile cloudflare up -d 2>&1; then
    fail "docker compose up failed — see journalctl -u vibept-tunnel.service"
  fi
else
  # Disable: stop + rm the sidecar. Leave the rest of the stack alone.
  docker compose -f "$COMPOSE_FILE" --profile cloudflare stop cloudflared 2>&1 || true
  docker compose -f "$COMPOSE_FILE" --profile cloudflare rm -f cloudflared 2>&1 || true
fi

write_status ok ""
rm -f "$REQUEST_FILE"
exit 0
