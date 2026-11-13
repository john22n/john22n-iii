#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="${IMAGE:-ghcr.io/john22n/john22n-iii:latest}"
CONTAINER="${CONTAINER:-john22n-iii}"
HOST_PORT="${HOST_PORT:-3000}"
DATA_DIR="${DATA_DIR:-/var/lib/john22n-iii}"
DB_PATH="${DATA_DIR}/blog.db"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/.env}"

# Hold the lock through the pull, replacement, and health check.
mkdir -p "$DATA_DIR"
exec 9>"${DATA_DIR}/deploy.lock"
if ! flock -n 9; then
  echo "Another deployment is already running; skipping."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  echo "Cannot connect to Docker. Run this script with sudo." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Environment file not found: ${ENV_FILE}" >&2
  echo "Set ENV_FILE if the VPS .env is stored elsewhere." >&2
  exit 1
fi

if ! grep -Eq '^BLOG_ADMIN_KEY=.+$' "$ENV_FILE"; then
  echo "BLOG_ADMIN_KEY is missing or empty in ${ENV_FILE}." >&2
  exit 1
fi

echo "Pulling ${IMAGE}..."
docker pull "$IMAGE"
IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  CURRENT_IMAGE="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
  RUNNING="$(docker inspect --format '{{.State.Running}}' "$CONTAINER")"
  if [[ "$CURRENT_IMAGE" == "$IMAGE_ID" && "$RUNNING" == "true" ]]; then
    echo "Published image is already running; no deployment needed."
    exit 0
  fi
fi

install -d -o 1000 -g 1000 -m 750 "$DATA_DIR"

if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" == "true" ]]; then
    echo "Stopping the existing ${CONTAINER} container..."
    docker stop --time 30 "$CONTAINER"
  fi

  if [[ ! -f "$DB_PATH" ]]; then
    echo "Migrating the existing database to ${DB_PATH}..."
    docker cp "${CONTAINER}:/home/node/app/blog.db" "$DB_PATH"
    chown 1000:1000 "$DB_PATH"
    chmod 640 "$DB_PATH"
  fi

  docker rm "$CONTAINER"
fi

echo "Starting ${CONTAINER}..."
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "127.0.0.1:${HOST_PORT}:3000" \
  --env-file "$ENV_FILE" \
  -e NODE_ENV=production \
  -e BLOG_DB_PATH=/data/blog.db \
  -e RESUME_PATH=/data/john-noriega-resume.pdf \
  -v "${DATA_DIR}:/data" \
  "$IMAGE_ID"

echo "Waiting for the application health check..."
for attempt in {1..15}; do
  if docker exec "$CONTAINER" node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(response => { if (!response.ok) process.exit(1) })" \
    >/dev/null 2>&1; then
    echo "Deployment complete: ${IMAGE} is running on port ${HOST_PORT}."
    exit 0
  fi

  sleep 2
done

echo "The new container did not become healthy. Recent logs:" >&2
docker logs --tail 100 "$CONTAINER" >&2
exit 1
