#!/usr/bin/env bash
# One-time setup on each fresh b3-8 instance (Debian/Ubuntu image).
# Run AS ROOT on the instance itself:  sudo bash provision-host.sh
set -euo pipefail

REMOTE_DIR=/opt/a11ydocs

# Docker CE + compose plugin.
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "${SUDO_USER:-debian}" || true

mkdir -p "$REMOTE_DIR"
chown "${SUDO_USER:-debian}" "$REMOTE_DIR"

# Notification sweep (hourly) + telemetry prune (daily). Runs inside the api
# container so it reuses the container's env/secrets. Install on ONE host only
# — both hosts sweeping doubles nothing (idempotent) but wastes DB work.
if [ "${INSTALL_CRON:-no}" = "yes" ]; then
  install -m 0644 /dev/stdin /etc/cron.d/a11ydocs <<'CRON'
SHELL=/bin/sh
# Hourly notification sweep (trial expiry, renewal reminders, delivery).
7 * * * * root docker exec a11ydocs-api node apps/api/dist/scripts/sweep.js >> /var/log/a11ydocs-sweep.log 2>&1
# Daily telemetry prune (retention: TELEMETRY_RETENTION_DAYS).
23 3 * * * root docker exec a11ydocs-api node apps/api/dist/scripts/prune-telemetry.js >> /var/log/a11ydocs-prune.log 2>&1
CRON
  echo "Cron installed (/etc/cron.d/a11ydocs)."
fi

echo "Host provisioned. Next: copy .env to ${REMOTE_DIR}/.env, docker login the registry, then run scripts/deploy.sh from your machine."
