#!/usr/bin/env bash
# Rolling deploy to the OVH instances over SSH.
# Each host must have: docker + compose plugin, /opt/sempdf/ containing
# docker-compose.prod.yml and .env (see scripts/provision-host.sh).
#
# Usage:
#   HOSTS="10.0.0.11 10.0.0.12" scripts/deploy.sh [tag]
#   SSH_USER=debian HOSTS=... scripts/deploy.sh v1.2.0
#
# Rolls one host at a time and waits for /readyz before moving on, so the LB
# always has a healthy backend.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${HOSTS:?Set HOSTS to a space-separated list of instance IPs/names}"
SSH_USER="${SSH_USER:-debian}"
TAG="${1:-latest}"
REMOTE_DIR="${REMOTE_DIR:-/opt/sempdf}"

for host in $HOSTS; do
  echo "── Deploying ${TAG} to ${host} ──"
  # Ship compose + collector config (env stays on the host — it holds secrets).
  scp -q docker-compose.prod.yml otel-collector-config.yaml \
    "${SSH_USER}@${host}:${REMOTE_DIR}/"
  ssh "${SSH_USER}@${host}" "
    set -euo pipefail
    cd '${REMOTE_DIR}'
    grep -q '^TAG=' .env && sed -i 's/^TAG=.*/TAG=${TAG}/' .env || echo 'TAG=${TAG}' >> .env
    docker compose -f docker-compose.prod.yml --env-file .env pull
    docker compose -f docker-compose.prod.yml --env-file .env up -d
  "
  echo "Waiting for ${host} readiness..."
  for i in $(seq 1 30); do
    if ssh "${SSH_USER}@${host}" "wget -qO- http://127.0.0.1/readyz" >/dev/null 2>&1; then
      echo "${host} ready."
      break
    fi
    [ "$i" -eq 30 ] && { echo "ERROR: ${host} never became ready — stopping rollout." >&2; exit 1; }
    sleep 2
  done
done

echo "Deploy of ${TAG} complete on: ${HOSTS}"
