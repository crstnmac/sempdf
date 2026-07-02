#!/usr/bin/env bash
# One-off schema migration against any database (local compose db or OVH managed PG).
# Runs drizzle-kit push from the dev-dependency build stage, so production
# images never carry migration tooling.
#
# Usage:
#   scripts/migrate.sh                                  # local compose db
#   DATABASE_URL='postgres://...' scripts/migrate.sh    # managed PG (run from a host inside the vRack)
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${DATABASE_URL:-}" ]; then
  docker compose run --rm -e DATABASE_URL="$DATABASE_URL" --no-deps migrate
else
  docker compose run --rm migrate
fi
