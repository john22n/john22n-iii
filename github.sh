#!/usr/bin/env bash

set -euo pipefail

IMAGE="${IMAGE:-ghcr.io/john22n/john22n-iii:latest}"
CONTAINER="${CONTAINER:-john22n-iii}"
HOST_PORT="${HOST_PORT:-3000}"
DATA_DIR="${DATA_DIR:-/var/lib/john22n-iii}"
DB_PATH="${DATA_DIR}/blog.db"

if ! docker info >/dev/null 2>&1; then
  echo "Cannot connect to Docker. Run this script with sudo." >&2
  exit 1
fi

echo "Pulling ${IMAGE}..."
docker pull "$IMAGE"

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
  -p "${HOST_PORT}:3000" \
  -e BLOG_DB_PATH=/data/blog.db \
  -v "${DATA_DIR}:/data" \
  "$IMAGE"

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
