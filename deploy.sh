#!/usr/bin/env bash
# Run on the VPS from the directory containing docker-compose.yml and .env.
set -euo pipefail

image="${1:?Usage: bash deploy.sh ghcr.io/owner/saul@sha256:<digest>}"
if [[ ! "$image" =~ ^ghcr\.io/[a-z0-9_./-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo 'Use an immutable GHCR image digest from the Release workflow.' >&2
  exit 1
fi
test -f .env || { echo 'Create the production .env on the VPS first.' >&2; exit 1; }
# Also serializes manual deployments against the Actions deployment.
exec 9>.deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }

export SAUL_IMAGE="$image"
docker compose config --quiet
docker compose pull
# Never run two processes against the same Pi storage, even during replacement.
docker compose stop --timeout 60 saul-api
if ! docker compose up -d --no-build --wait --wait-timeout 180; then
  echo 'Deployment failed. Inspect docker compose logs. No volumes or backups were deleted.' >&2
  echo 'Do not roll back across database migrations without checking compatibility.' >&2
  exit 1
fi
echo "Ready: $image"
