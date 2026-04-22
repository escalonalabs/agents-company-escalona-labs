#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
POSTGRES_DB="${POSTGRES_DB:-agents_company}"
POSTGRES_USER="${POSTGRES_USER:-agents_company}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-agents_company}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
BACKUP_TIMESTAMP="${BACKUP_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
BACKUP_FILE="${BACKUP_FILE:-$BACKUP_DIR/agents-company-postgres-$BACKUP_TIMESTAMP.dump}"

fail() {
  printf 'backup-postgres: %s\n' "$1" >&2
  exit 1
}

detect_postgres_container() {
  local -a filters
  filters=(--filter "label=com.docker.compose.service=postgres")

  if [[ -n "$COMPOSE_PROJECT_NAME" ]]; then
    filters+=(--filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME")
  fi

  docker ps --format '{{.Names}}' "${filters[@]}" | head -n 1
}

require_running_container() {
  if [[ -z "$POSTGRES_CONTAINER" ]]; then
    POSTGRES_CONTAINER="$(detect_postgres_container)"
  fi

  [[ -n "$POSTGRES_CONTAINER" ]] || \
    fail "could not detect a running postgres container. Set POSTGRES_CONTAINER or COMPOSE_PROJECT_NAME."

  docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1 || \
    fail "container '$POSTGRES_CONTAINER' was not found."

  [[ "$(docker inspect -f '{{.State.Running}}' "$POSTGRES_CONTAINER")" == "true" ]] || \
    fail "container '$POSTGRES_CONTAINER' is not running."
}

require_running_container
mkdir -p "$BACKUP_DIR"

docker exec \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$POSTGRES_CONTAINER" \
  pg_dump \
  --format=custom \
  --compress=6 \
  --username="$POSTGRES_USER" \
  --dbname="$POSTGRES_DB" > "$BACKUP_FILE"

[[ -s "$BACKUP_FILE" ]] || fail "backup file '$BACKUP_FILE' is empty."

cat "$BACKUP_FILE" | docker exec -i "$POSTGRES_CONTAINER" pg_restore --list >/dev/null

BACKUP_SHA256="$(sha256sum "$BACKUP_FILE" | awk '{print $1}')"

printf 'backup_file=%s\n' "$BACKUP_FILE"
printf 'sha256=%s\n' "$BACKUP_SHA256"
