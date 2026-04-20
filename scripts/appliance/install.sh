#!/usr/bin/env bash
# Vibe Payroll Time — one-shot appliance installer.
#
# Target: Ubuntu Server 24.04 LTS on a GMKtec NucBox M6 (or any x86_64 Linux
# with systemd). Installs Docker Engine, clones this repository, and brings
# up the production stack.
#
# Usage (as root or with sudo):
#   curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/appliance/install.sh | sudo bash
# Or after cloning:
#   sudo bash scripts/appliance/install.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/KisaesDevLab/Vibe-Payroll-Time.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BRANCH="${BRANCH:-main}"
PROFILE="${PROFILE:-public}"   # public | cloudflare | tailscale

log()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[install]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[install]\033[0m %s\n' "$*" >&2; }

require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "must be run as root (use sudo)"
    exit 1
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "docker already installed"
    return
  fi

  log "installing docker engine"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg lsb-release

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  codename=$(lsb_release -cs)
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $codename stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
}

clone_or_update() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    log "cloning $REPO_URL to $INSTALL_DIR"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

seed_env() {
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    log ".env already present; leaving as-is"
    return
  fi

  log "generating .env from template"
  cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"

  # Populate strong secrets.
  local jwt secrets pgpass
  jwt=$(openssl rand -hex 64)
  secrets=$(openssl rand -hex 32)
  pgpass=$(openssl rand -hex 24)

  sed -i \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$jwt|" \
    -e "s|^SECRETS_ENCRYPTION_KEY=.*|SECRETS_ENCRYPTION_KEY=$secrets|" \
    -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$pgpass|" \
    -e "s|^APPLIANCE_ID=.*|APPLIANCE_ID=$(hostname -s)|" \
    -e "s|^NODE_ENV=.*|NODE_ENV=production|" \
    "$INSTALL_DIR/.env"

  warn "review $INSTALL_DIR/.env and set APP_DOMAIN / tunnel tokens before bringing the stack up"
}

bring_up_stack() {
  log "starting stack with profile '$PROFILE'"
  (
    cd "$INSTALL_DIR"
    docker compose -f docker-compose.prod.yml --profile "$PROFILE" pull || true
    docker compose -f docker-compose.prod.yml --profile "$PROFILE" build
    docker compose -f docker-compose.prod.yml --profile "$PROFILE" up -d
  )
}

install_systemd_unit() {
  local unit=/etc/systemd/system/vibept.service
  if [[ -f $unit ]]; then
    log "systemd unit already present"
    return
  fi

  log "installing systemd unit $unit"
  cat > "$unit" <<SYSTEMD
[Unit]
Description=Vibe Payroll Time appliance
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml --profile $PROFILE up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml --profile $PROFILE down

[Install]
WantedBy=multi-user.target
SYSTEMD

  systemctl daemon-reload
  systemctl enable vibept.service
}

main() {
  require_root
  install_docker
  clone_or_update
  seed_env
  bring_up_stack
  install_systemd_unit

  log "install complete"
  log "logs: docker compose -f $INSTALL_DIR/docker-compose.prod.yml logs -f"
  log "edit config: $INSTALL_DIR/.env, then 'systemctl restart vibept'"
}

main "$@"
