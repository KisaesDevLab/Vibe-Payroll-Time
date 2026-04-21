#!/usr/bin/env bash
# Vibe Payroll Time — one-shot appliance installer.
#
# Installs Docker + the app stack on a fresh Ubuntu Server 24.04 LTS box
# (e.g. a GMKtec NucBox M6). Interactive by default — the only things the
# operator must decide are (a) how users will reach the appliance (tunnel
# or public), and (b) whatever credentials that choice requires.
#
# Everything security-relevant is auto-generated: JWT secret, at-rest
# encryption key, badge signing key, Postgres password. The first
# SuperAdmin is created via the first-run web wizard inside the app, so
# no default credential is ever written to disk.
#
# Usage (on the appliance):
#   # Interactive, after cloning:
#   sudo bash /opt/vibept/scripts/appliance/install.sh
#
#   # Piped remote install (non-interactive — set env vars for ingress):
#   curl -fsSL https://raw.githubusercontent.com/KisaesDevLab/Vibe-Payroll-Time/main/scripts/appliance/install.sh \
#     | PROFILE=cloudflare CLOUDFLARE_TUNNEL_TOKEN=xxx sudo -E bash
#
# Env-var overrides (any value skips the matching prompt):
#   INSTALL_DIR               where to clone/install          [/opt/vibept]
#   BRANCH                    git branch                      [main]
#   REPO_URL                  git url to clone
#   PROFILE                   cloudflare | tailscale | public
#   APP_DOMAIN                public domain (profile=public)
#   CADDY_ACME_EMAIL          Let's Encrypt contact (profile=public)
#   CLOUDFLARE_TUNNEL_TOKEN   tunnel token (profile=cloudflare)
#   TAILSCALE_AUTHKEY         auth key (profile=tailscale)
#   TAILSCALE_HOSTNAME        hostname on tailnet [vibept]
#   SKIP_DOCKER_INSTALL=1     skip docker apt install
#   KEEP_EXISTING_ENV=1       reuse existing .env without prompting

set -euo pipefail

# ---------- config ----------
REPO_URL="${REPO_URL:-https://github.com/KisaesDevLab/Vibe-Payroll-Time.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vibept}"
BRANCH="${BRANCH:-main}"

# Global state — filled in by gather_config / load_env_profile.
CHOSEN_PROFILE=""
CHOSEN_APP_DOMAIN=""
CHOSEN_ACME_EMAIL=""
CHOSEN_CF_TOKEN=""
CHOSEN_TS_AUTHKEY=""
CHOSEN_TS_HOSTNAME=""

# ---------- output helpers ----------
_tty() { [[ -t 1 ]] && printf '%s' "$1" || true; }

log()  { printf '%s[install]%s %s\n' "$(_tty $'\033[1;34m')" "$(_tty $'\033[0m')" "$*"; }
warn() { printf '%s[install]%s %s\n' "$(_tty $'\033[1;33m')" "$(_tty $'\033[0m')" "$*" >&2; }
err()  { printf '%s[install]%s %s\n' "$(_tty $'\033[1;31m')" "$(_tty $'\033[0m')" "$*" >&2; }
ok()   { printf '%s[install]%s %s\n' "$(_tty $'\033[1;32m')" "$(_tty $'\033[0m')" "$*"; }

banner() {
  local line='============================================================'
  printf '\n%s%s%s\n%s%s%s\n%s%s%s\n\n' \
    "$(_tty $'\033[1m')" "$line" "$(_tty $'\033[0m')" \
    "$(_tty $'\033[1m')" "$1"   "$(_tty $'\033[0m')" \
    "$(_tty $'\033[1m')" "$line" "$(_tty $'\033[0m')"
}

is_interactive() { [[ -t 0 && -t 1 ]]; }

# ask PROMPT [DEFAULT]  — echoes the answer. Fails fast on non-interactive
# runs if no default is supplied.
ask() {
  local prompt="$1" default="${2:-}" reply
  if ! is_interactive; then
    if [[ -n $default ]]; then
      echo "$default"; return
    fi
    err "non-interactive run: required value missing ($prompt)"
    exit 1
  fi
  if [[ -n $default ]]; then
    read -r -p "$prompt [$default]: " reply
    echo "${reply:-$default}"
  else
    while :; do
      read -r -p "$prompt: " reply
      [[ -n $reply ]] && { echo "$reply"; return; }
      warn "value required"
    done
  fi
}

# ask_secret PROMPT — prompts with echo disabled, never loggable.
ask_secret() {
  local prompt="$1" reply
  if ! is_interactive; then
    err "non-interactive run cannot prompt for secret ($prompt); set the env var instead"
    exit 1
  fi
  while :; do
    read -r -s -p "$prompt: " reply
    echo
    [[ -n $reply ]] && { echo "$reply"; return; }
    warn "value required"
  done
}

# yn PROMPT [DEFAULT=y|n] — returns 0 for yes, 1 for no.
yn() {
  local prompt="$1" default="${2:-y}" reply
  if ! is_interactive; then
    [[ $default == y ]] && return 0 || return 1
  fi
  while :; do
    if [[ $default == y ]]; then
      read -r -p "$prompt [Y/n]: " reply; reply="${reply:-y}"
    else
      read -r -p "$prompt [y/N]: " reply; reply="${reply:-n}"
    fi
    case "$reply" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo])     return 1 ;;
      *) warn "answer y or n" ;;
    esac
  done
}

# ---------- guards ----------
require_root() {
  if [[ $EUID -ne 0 ]]; then
    err "must be run as root (use sudo)"
    exit 1
  fi
}

# ---------- docker ----------
install_docker() {
  if [[ -n "${SKIP_DOCKER_INSTALL:-}" ]]; then
    log "SKIP_DOCKER_INSTALL set — skipping docker install"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    log "docker already installed"
    return
  fi

  log "installing docker engine (this can take a minute)"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg lsb-release

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  local codename
  codename=$(lsb_release -cs)
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $codename stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
}

# ---------- clone ----------
clone_or_update() {
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --all --prune
    git -C "$INSTALL_DIR" checkout "$BRANCH"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    log "cloning $REPO_URL to $INSTALL_DIR"
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
}

# ---------- config gathering ----------
validate_email()  { [[ $1 =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; }
validate_domain() { [[ $1 =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$ ]]; }

prompt_profile() {
  if [[ -n "${PROFILE:-}" ]]; then
    case "$PROFILE" in
      public|cloudflare|tailscale) CHOSEN_PROFILE="$PROFILE"; return ;;
      *) err "invalid PROFILE='$PROFILE' (want: public|cloudflare|tailscale)"; exit 1 ;;
    esac
  fi
  if ! is_interactive; then
    err "non-interactive run: set PROFILE=cloudflare|tailscale|public"
    exit 1
  fi

  cat <<'EOF'
How should users reach this appliance?

  1) Cloudflare Tunnel   (recommended — no router/firewall changes, free)
  2) Tailscale Funnel    (private tailnet, optional public funnel)
  3) Public internet     (needs a domain, ports 80/443 open, Let's Encrypt)

EOF
  local reply
  while :; do
    read -r -p "Choice [1-3] (default 1): " reply
    reply="${reply:-1}"
    case "$reply" in
      1) CHOSEN_PROFILE=cloudflare; return ;;
      2) CHOSEN_PROFILE=tailscale;  return ;;
      3) CHOSEN_PROFILE=public;     return ;;
      *) warn "choose 1, 2, or 3" ;;
    esac
  done
}

prompt_public_config() {
  if [[ -n "${APP_DOMAIN:-}" ]]; then
    validate_domain "$APP_DOMAIN" || { err "APP_DOMAIN is not a valid domain"; exit 1; }
    CHOSEN_APP_DOMAIN="$APP_DOMAIN"
  else
    while :; do
      CHOSEN_APP_DOMAIN=$(ask "Public domain (e.g. time.yourfirm.com)")
      validate_domain "$CHOSEN_APP_DOMAIN" && break
      warn "that doesn't look like a domain — try again"
    done
  fi

  if [[ -n "${CADDY_ACME_EMAIL:-}" ]]; then
    validate_email "$CADDY_ACME_EMAIL" || { err "CADDY_ACME_EMAIL is not a valid email"; exit 1; }
    CHOSEN_ACME_EMAIL="$CADDY_ACME_EMAIL"
  else
    while :; do
      CHOSEN_ACME_EMAIL=$(ask "Email for Let's Encrypt certificate notices")
      validate_email "$CHOSEN_ACME_EMAIL" && break
      warn "that doesn't look like an email — try again"
    done
  fi
}

prompt_cloudflare_config() {
  if [[ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]]; then
    CHOSEN_CF_TOKEN="$CLOUDFLARE_TUNNEL_TOKEN"
    return
  fi
  cat <<'EOF'

Create a tunnel at https://one.dash.cloudflare.com
→ Networks → Tunnels → "Create a tunnel" → pick "Cloudflared".
Under "Public Hostname", forward to http://caddy:8080. Copy the token.

EOF
  CHOSEN_CF_TOKEN=$(ask_secret "Cloudflare Tunnel token")
}

prompt_tailscale_config() {
  if [[ -n "${TAILSCALE_AUTHKEY:-}" ]]; then
    CHOSEN_TS_AUTHKEY="$TAILSCALE_AUTHKEY"
  else
    cat <<'EOF'

Create a reusable ephemeral auth key at https://login.tailscale.com
→ Settings → Keys → Generate auth key (check "Reusable" and "Ephemeral").

EOF
    CHOSEN_TS_AUTHKEY=$(ask_secret "Tailscale auth key")
  fi
  CHOSEN_TS_HOSTNAME="${TAILSCALE_HOSTNAME:-$(ask "Hostname on the tailnet" "vibept")}"
}

gather_config() {
  prompt_profile
  case "$CHOSEN_PROFILE" in
    public)     prompt_public_config ;;
    cloudflare) prompt_cloudflare_config ;;
    tailscale)  prompt_tailscale_config ;;
  esac
}

summarize_config() {
  echo
  echo "Review:"
  echo "  Install dir:      $INSTALL_DIR"
  echo "  Ingress:          $CHOSEN_PROFILE"
  case "$CHOSEN_PROFILE" in
    public)
      echo "  Domain:           $CHOSEN_APP_DOMAIN"
      echo "  Let's Encrypt:    $CHOSEN_ACME_EMAIL"
      ;;
    cloudflare)
      echo "  Tunnel token:     (saved to .env — not echoed)"
      ;;
    tailscale)
      echo "  Auth key:         (saved to .env — not echoed)"
      echo "  Tailnet hostname: $CHOSEN_TS_HOSTNAME"
      ;;
  esac
  echo
  yn "Continue with these settings?" y || { err "aborted"; exit 1; }
}

# ---------- .env ----------
# Load PROFILE from an existing .env so re-runs know which compose profile
# to use without asking again.
load_env_profile() {
  local env_path="$INSTALL_DIR/.env"
  [[ -f $env_path ]] || return 1
  local line
  line=$(grep -E '^PROFILE=' "$env_path" | tail -1 || true)
  if [[ -n $line ]]; then
    CHOSEN_PROFILE="${line#PROFILE=}"
  fi
  return 0
}

write_env() {
  local env_path="$INSTALL_DIR/.env"

  log "writing $env_path"
  local jwt secrets badge pgpass
  jwt=$(openssl rand -hex 64)
  secrets=$(openssl rand -hex 32)
  badge=$(openssl rand -hex 32)
  pgpass=$(openssl rand -hex 24)

  local appliance_id
  appliance_id=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo "vibept-appliance")

  umask 077
  cat > "$env_path" <<ENV
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# To reconfigure, rerun install.sh — do not hand-edit unless you know
# what you're doing. JWT_SECRET / SECRETS_ENCRYPTION_KEY / BADGE_SIGNING_SECRET
# cannot be rotated without invalidating sessions, encrypted per-company
# API secrets, and printed badges respectively. Back up this file.

# Ingress profile the installer brings up and the systemd unit starts.
PROFILE=$CHOSEN_PROFILE

APPLIANCE_ID=$appliance_id
NODE_ENV=production
LOG_LEVEL=info

BACKEND_PORT=4000
BACKEND_HOST=0.0.0.0

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=vibept
POSTGRES_PASSWORD=$pgpass
POSTGRES_DB=vibept
DATABASE_URL=postgres://vibept:$pgpass@postgres:5432/vibept

JWT_SECRET=$jwt
SECRETS_ENCRYPTION_KEY=$secrets
BADGE_SIGNING_SECRET=$badge

VITE_API_BASE_URL=/api/v1
VITE_APP_NAME=Vibe Payroll Time

MIGRATE_ON_BOOT=true

# Ingress — public profile
APP_DOMAIN=${CHOSEN_APP_DOMAIN}
CADDY_ACME_EMAIL=${CHOSEN_ACME_EMAIL:-admin@example.com}
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443

# Ingress — Cloudflare Tunnel profile
CLOUDFLARE_TUNNEL_TOKEN=${CHOSEN_CF_TOKEN}

# Ingress — Tailscale Funnel profile
TAILSCALE_AUTHKEY=${CHOSEN_TS_AUTHKEY}
TAILSCALE_HOSTNAME=${CHOSEN_TS_HOSTNAME:-vibept}

# Dev/test only. Leave false on a real appliance — set per-company
# muting in the notifications UI instead.
NOTIFICATIONS_DISABLED=false

# Payroll CSV export directory (relative to the backend container's cwd).
EXPORTS_DIR=./exports

# Licensing — off by default. Turn on once the kisaes-license-portal is
# live for this product and LICENSE_PUBKEY_PEM is pinned.
LICENSING_ENFORCED=false
LICENSE_PUBKEY_PEM=
LICENSE_PORTAL_HEARTBEAT_URL=

# EmailIt appliance-wide fallback, AI fallback, retention, and log level
# are all edited from the SuperAdmin UI at /appliance/settings. They are
# deliberately NOT in this file — no SSH needed.
ENV
  chmod 600 "$env_path"
}

handle_existing_env() {
  local env_path="$INSTALL_DIR/.env"
  [[ -f $env_path ]] || return 1  # no existing env → caller will gather + write

  if [[ -n "${KEEP_EXISTING_ENV:-}" ]]; then
    log "KEEP_EXISTING_ENV set — reusing $env_path"
    load_env_profile || true
    [[ -n $CHOSEN_PROFILE ]] || CHOSEN_PROFILE="${PROFILE:-cloudflare}"
    return 0
  fi

  if ! is_interactive; then
    log "existing .env found and run is non-interactive — reusing it"
    load_env_profile || true
    [[ -n $CHOSEN_PROFILE ]] || CHOSEN_PROFILE="${PROFILE:-cloudflare}"
    return 0
  fi

  warn ".env already exists at $env_path"
  if yn "Keep it and just ensure the stack is running?" y; then
    load_env_profile || true
    if [[ -z $CHOSEN_PROFILE ]]; then
      warn "existing .env has no PROFILE= line; asking which profile to start"
      prompt_profile
    else
      log "detected profile in existing .env: $CHOSEN_PROFILE"
    fi
    return 0
  fi

  local backup
  backup="$env_path.backup.$(date +%Y%m%d%H%M%S)"
  cp "$env_path" "$backup"
  log "backed up old .env to $backup"
  return 1  # signal caller to gather + write fresh
}

# ---------- stack ----------
# Build args baked into the image and surfaced at /api/v1/admin/health so
# the appliance dashboard can show "running v1.2.3". Uses git describe so
# tagged releases show a real version; untagged dev checkouts show a SHA.
compute_build_args() {
  APP_VERSION=$(git -C "$INSTALL_DIR" describe --tags --always --dirty 2>/dev/null || echo "unknown")
  GIT_SHA=$(git -C "$INSTALL_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")
  BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  export APP_VERSION GIT_SHA BUILD_DATE
  log "building version=$APP_VERSION sha=${GIT_SHA:0:7} date=$BUILD_DATE"
}

bring_up_stack() {
  compute_build_args
  log "starting stack with profile '$CHOSEN_PROFILE'"
  (
    cd "$INSTALL_DIR"
    docker compose -f docker-compose.prod.yml --profile "$CHOSEN_PROFILE" pull || true
    docker compose -f docker-compose.prod.yml --profile "$CHOSEN_PROFILE" build
    docker compose -f docker-compose.prod.yml --profile "$CHOSEN_PROFILE" up -d
  )
}

install_systemd_unit() {
  local unit=/etc/systemd/system/vibept.service
  local desired
  desired=$(cat <<SYSTEMD
[Unit]
Description=Vibe Payroll Time appliance
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml --profile $CHOSEN_PROFILE up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml --profile $CHOSEN_PROFILE down

[Install]
WantedBy=multi-user.target
SYSTEMD
)
  if [[ -f $unit ]] && [[ "$(cat "$unit")" == "$desired" ]]; then
    log "systemd unit already up-to-date"
    return
  fi
  log "writing systemd unit $unit"
  printf '%s\n' "$desired" > "$unit"
  systemctl daemon-reload
  systemctl enable vibept.service >/dev/null
}

# ----- self-service updater wiring -----
# Creates the bind-mount dir that the backend container writes request.json
# to, and installs the path+service systemd units that watch it.
setup_update_control_dir() {
  local dir="$INSTALL_DIR/update-control"
  mkdir -p "$dir"
  # The backend container runs as uid 2000 (pinned in backend/Dockerfile)
  # so the non-root process can write request.json / read log.txt.
  chown 2000:2000 "$dir"
  chmod 0770 "$dir"
  log "update-control dir ready at $dir"
}

install_updater_units() {
  local src_dir="$INSTALL_DIR/scripts/appliance/systemd"
  local path_unit=/etc/systemd/system/vibept-updater.path
  local svc_unit=/etc/systemd/system/vibept-updater.service
  local changed=0

  if [[ ! -f "$src_dir/vibept-updater.path" ]] || [[ ! -f "$src_dir/vibept-updater.service" ]]; then
    warn "updater systemd templates missing in $src_dir — skipping self-service updater wiring"
    return
  fi

  if ! cmp -s "$src_dir/vibept-updater.path" "$path_unit"; then
    install -m 0644 "$src_dir/vibept-updater.path" "$path_unit"
    changed=1
  fi
  if ! cmp -s "$src_dir/vibept-updater.service" "$svc_unit"; then
    install -m 0644 "$src_dir/vibept-updater.service" "$svc_unit"
    changed=1
  fi

  if [[ $changed -eq 1 ]]; then
    log "installed/updated vibept-updater.{path,service}"
    systemctl daemon-reload
  else
    log "updater systemd units already up-to-date"
  fi

  systemctl enable --now vibept-updater.path >/dev/null 2>&1 || {
    warn "failed to enable vibept-updater.path — self-service updates from the UI will not work"
  }
}

wait_for_health() {
  log "waiting for backend to report healthy (up to 120s)..."
  local status
  for _ in $(seq 1 60); do
    status=$(docker inspect --format '{{.State.Health.Status}}' vibept-backend 2>/dev/null || echo "absent")
    if [[ $status == healthy ]]; then
      ok "backend is healthy"
      return 0
    fi
    sleep 2
  done
  warn "backend didn't report healthy within 120s — recent logs:"
  docker compose -f "$INSTALL_DIR/docker-compose.prod.yml" --profile "$CHOSEN_PROFILE" \
    logs --tail=40 backend 2>&1 | sed 's/^/  /' >&2 || true
  return 1
}

print_completion_banner() {
  local url
  case "$CHOSEN_PROFILE" in
    public)     url="https://$CHOSEN_APP_DOMAIN/" ;;
    cloudflare) url="(whatever hostname you mapped in your Cloudflare Tunnel)" ;;
    tailscale)  url="https://${CHOSEN_TS_HOSTNAME:-vibept}.<your-tailnet>.ts.net/" ;;
  esac

  banner "Install complete"
  cat <<EOF
  The appliance is running. Finish setup in your browser:

    1. Open:  $url
    2. The web wizard will ask for a SuperAdmin email + password.
       Pick whatever you like — no default credential is shipped, and
       the wizard refuses to run once an admin exists.
    3. Log in; add your first company and employees.

  Everyday operations:

    Tail logs:   docker compose -f $INSTALL_DIR/docker-compose.prod.yml logs -f
    Restart:     systemctl restart vibept
    Stop:        systemctl stop vibept
    Backup now:  $INSTALL_DIR/scripts/appliance/backup.sh
    Update:      $INSTALL_DIR/scripts/appliance/update.sh

  Secrets live in $INSTALL_DIR/.env (chmod 600). Back that file up —
  JWT_SECRET and SECRETS_ENCRYPTION_KEY cannot be regenerated without
  invalidating sessions and per-company API keys, and BADGE_SIGNING_SECRET
  cannot be rotated without a bulk badge reissue.
EOF
}

main() {
  require_root
  banner "Vibe Payroll Time — Appliance Installer"

  install_docker
  clone_or_update

  # If an existing .env is being kept, skip the prompts entirely.
  if ! handle_existing_env; then
    gather_config
    summarize_config
    write_env
  fi

  setup_update_control_dir
  bring_up_stack
  install_systemd_unit
  install_updater_units
  wait_for_health || warn "continuing despite health-check timeout — see logs above"
  print_completion_banner
}

main "$@"
