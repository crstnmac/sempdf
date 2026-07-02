#!/usr/bin/env bash
# Tag and push both images to the OVH Managed Private Registry.
# Usage: REGISTRY=abc.gra7.container-registry.ovh.net/a11ydocs scripts/push.sh [tag]
# Login first: docker login <registry host> (Harbor robot account recommended).
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${REGISTRY:?Set REGISTRY, e.g. abc.gra7.container-registry.ovh.net/a11ydocs}"
TAG="${1:-$(git rev-parse --short HEAD)}"

for img in license-api license-web; do
  docker tag "${img}:${TAG}" "${REGISTRY}/${img}:${TAG}"
  docker tag "${img}:${TAG}" "${REGISTRY}/${img}:latest"
  docker push "${REGISTRY}/${img}:${TAG}"
  docker push "${REGISTRY}/${img}:latest"
done

echo "Pushed ${REGISTRY}/license-{api,web}:${TAG}"
