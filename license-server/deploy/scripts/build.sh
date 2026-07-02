#!/usr/bin/env bash
# Build both images from the workspace root context.
# Usage: scripts/build.sh [tag]   (default tag: current git short SHA)
set -euo pipefail
cd "$(dirname "$0")/../.."   # license-server workspace root

TAG="${1:-$(git rev-parse --short HEAD)}"

docker build -f deploy/api.Dockerfile -t "license-api:${TAG}" -t license-api:latest .
docker build -f deploy/web.Dockerfile -t "license-web:${TAG}" -t license-web:latest .

echo "Built license-api:${TAG} and license-web:${TAG}"
