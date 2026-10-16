#!/usr/bin/env bash
# One-time preparation of a fresh Ubuntu 22.04/24.04 or Debian 12 VPS. Run as root:
#
#   curl -fsSL https://raw.githubusercontent.com/KDK-420/ordr.ae-whatsapp/main/deploy/bootstrap.sh | bash
#
# It installs Docker, opens only SSH, 80 and 443 in the firewall, turns on unattended security
# updates, clones the repository to /opt/ordr, creates deploy/.env with generated secrets, and
# schedules a nightly database backup. Safe to run again. Override with env vars:
#   REPO_URL, BRANCH (default main), APP_DIR (default /opt/ordr)
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/KDK-420/ordr.ae-whatsapp.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/ordr}"

log() { printf '\n==> %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

log "Installing base packages"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw unattended-upgrades openssl >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine from the official repository"
  . /etc/os-release
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker
else
  log "Docker already installed: $(docker --version)"
fi

log "Configuring firewall (SSH, 80, 443 only)"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/    /'

log "Enabling unattended security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

if [ -d "$APP_DIR/.git" ]; then
  log "Updating repository in $APP_DIR"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" pull --quiet --ff-only origin "$BRANCH"
else
  log "Cloning $REPO_URL ($BRANCH) into $APP_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
chmod +x "$APP_DIR"/deploy/*.sh

ENV_FILE="$APP_DIR/deploy/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE with generated secrets"
  cp "$APP_DIR/deploy/.env.example" "$ENV_FILE"
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" "$ENV_FILE"
  sed -i "s/^META_VERIFY_TOKEN=.*/META_VERIFY_TOKEN=$(openssl rand -hex 16)/" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  log "Keeping existing $ENV_FILE"
fi
# Keys added after the file was first created get a generated value when still empty.
fill_if_empty() {
  if ! grep -q "^$1=" "$ENV_FILE"; then
    printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
  elif grep -q "^$1=\"\?\"\?$" "$ENV_FILE"; then
    sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE"
  fi
}
fill_if_empty AUTH_SECRET "$(openssl rand -hex 32)"
fill_if_empty SEED_ADMIN_EMAIL "owner@example.com"
fill_if_empty SEED_ADMIN_PASSWORD "$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"

log "Scheduling nightly Postgres backup at 03:00 server time"
mkdir -p "$APP_DIR/backups"
cat > /etc/cron.d/ordr-backup <<CRON
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
0 3 * * * root $APP_DIR/deploy/backup.sh >> /var/log/ordr-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/ordr-backup

cat <<NEXT

Server is ready. Next:

  1. Edit $ENV_FILE and set DOMAIN, META_APP_SECRET, and the SEED_* values
     (POSTGRES_PASSWORD and META_VERIFY_TOKEN are already generated).
  2. Make sure the DNS A record for DOMAIN points at this server.
  3. Run:  $APP_DIR/deploy/deploy.sh --seed

NEXT
