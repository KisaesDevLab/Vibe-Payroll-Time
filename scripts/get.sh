#!/usr/bin/env bash
# Copyright 2026 Kisaes LLC
# Licensed under the PolyForm Internal Use License 1.0.0.
# You may not distribute this software. See LICENSE for terms.
#
# Vibe Payroll Time — single-command install & update shim.
#
# What it does:
#   - On a fresh box (no existing install at $INSTALL_DIR/.env), fetches
#     and runs scripts/appliance/install.sh to stand the appliance up.
#   - On an already-installed box, fetches and runs
#     scripts/appliance/update.sh to upgrade in place.
#
# Why route through this file:
#   - One URL for both operations. The operator doesn't have to
#     remember which command applies to their box state.
#   - The shim itself is tiny and stable — install.sh / update.sh can
#     be refactored without breaking the advertised one-liner.
#   - Each invocation fetches the current install/update script from
#     the repo so the operator always runs the latest version, never a
#     stale copy cached on disk.
#
# Usage (from anywhere):
#   curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/get.sh | sudo bash
#
# Non-interactive with ingress pre-chosen (install-only — updates pick
# the existing profile up from .env automatically):
#   curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/get.sh \
#     | PROFILE=cloudflare CLOUDFLARE_TUNNEL_TOKEN=xxx sudo -E bash
#
# Env-var overrides:
#   INSTALL_DIR   where the appliance lives       [/opt/vibept]
#   BRANCH        git branch to fetch scripts from [main]
#   FORCE         `install` or `update` to skip the state check
#
# All other env vars (PROFILE, CLOUDFLARE_TUNNEL_TOKEN, APP_DOMAIN,
# CADDY_ACME_EMAIL, TAILSCALE_AUTHKEY, HEALTH_TIMEOUT_SECONDS, etc.)
# are forwarded untouched to whichever script we dispatch to — see
# scripts/appliance/install.sh and scripts/appliance/update.sh for
# the full list.

set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BRANCH="${BRANCH:-main}"
FORCE="${FORCE:-}"

BASE_URL="https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/$BRANCH/scripts/appliance"

want_install=0
want_update=0

if [[ "$FORCE" == "install" ]]; then
  want_install=1
elif [[ "$FORCE" == "update" ]]; then
  want_update=1
elif [[ -f "$INSTALL_DIR/.env" && -f "$INSTALL_DIR/docker-compose.prod.yml" ]]; then
  # .env is only written by install.sh; if both are present the box
  # has been installed and the operator wants to update.
  want_update=1
else
  want_install=1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required but not installed." >&2
  echo "Install it and retry: apt-get install -y curl" >&2
  exit 1
fi

if [[ $want_install -eq 1 ]]; then
  echo "▶ Vibe Payroll Time — installing (no existing install found at $INSTALL_DIR)"
  echo "  Fetching $BASE_URL/install.sh"
  curl -fsSL "$BASE_URL/install.sh" | bash
else
  echo "▶ Vibe Payroll Time — updating (existing install detected at $INSTALL_DIR)"
  echo "  Fetching $BASE_URL/update.sh"
  # update.sh re-reads everything from .env; it doesn't need env-var
  # passthrough unless the operator is pinning IMAGE_TAG or BRANCH,
  # which they can set on the parent shell before piping.
  curl -fsSL "$BASE_URL/update.sh" | bash
fi
