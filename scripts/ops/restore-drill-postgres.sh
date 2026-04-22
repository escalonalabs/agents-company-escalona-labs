#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-}"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
POSTGRES_USER="${POSTGRES_USER:-agents_company}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-agents_company}"
RESTORE_DRILL_DB="${RESTORE_DRILL_DB:-agents_company_restore_drill}"
KEEP_RESTORE_DB="${KEEP_RESTORE_DB:-0}"
BACKUP_FILE="${BACKUP_FILE:-}"

fail() {
  printf 'restore-drill-postgres: %s\n' "$1" >&2
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

create_backup_if_missing() {
  if [[ -n "$BACKUP_FILE" ]]; then
    return
  fi

  local backup_output
  backup_output="$(bash "$ROOT_DIR/scripts/ops/backup-postgres.sh")"
  BACKUP_FILE="$(printf '%s\n' "$backup_output" | awk -F= '/^backup_file=/{print $2}')"
  [[ -n "$BACKUP_FILE" ]] || fail "backup helper did not return a backup file."
  printf '%s\n' "$backup_output"
}

cleanup_restore_db() {
  if [[ "$KEEP_RESTORE_DB" == "1" ]]; then
    return
  fi

  docker exec \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    "$POSTGRES_CONTAINER" \
    psql \
    --username="$POSTGRES_USER" \
    --dbname=postgres \
    --command="drop database if exists \"$RESTORE_DRILL_DB\";" >/dev/null
}

require_running_container
create_backup_if_missing
[[ -f "$BACKUP_FILE" ]] || fail "backup file '$BACKUP_FILE' does not exist."

trap cleanup_restore_db EXIT

docker exec \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$POSTGRES_CONTAINER" \
  psql \
  --username="$POSTGRES_USER" \
  --dbname=postgres \
  --command="drop database if exists \"$RESTORE_DRILL_DB\";" >/dev/null

docker exec \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$POSTGRES_CONTAINER" \
  psql \
  --username="$POSTGRES_USER" \
  --dbname=postgres \
  --command="create database \"$RESTORE_DRILL_DB\";" >/dev/null

cat "$BACKUP_FILE" | docker exec \
  -i \
  -e PGPASSWORD="$POSTGRES_PASSWORD" \
  "$POSTGRES_CONTAINER" \
  pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --username="$POSTGRES_USER" \
  --dbname="$RESTORE_DRILL_DB" >/dev/null

COUNTS="$(
  docker exec \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    "$POSTGRES_CONTAINER" \
    psql \
    --tuples-only \
    --no-align \
    --username="$POSTGRES_USER" \
    --dbname="$RESTORE_DRILL_DB" \
    --command="
      select
        (select count(*) from companies),
        (select count(*) from objectives),
        (select count(*) from work_items),
        (select count(*) from runs),
        (select count(*) from approvals);
    " | tr -d '[:space:]'
)"

IFS='|' read -r COMPANY_COUNT OBJECTIVE_COUNT WORK_ITEM_COUNT RUN_COUNT APPROVAL_COUNT <<< "$COUNTS"

printf 'backup_file=%s\n' "$BACKUP_FILE"
printf 'restore_db=%s\n' "$RESTORE_DRILL_DB"
printf 'companies=%s\n' "$COMPANY_COUNT"
printf 'objectives=%s\n' "$OBJECTIVE_COUNT"
printf 'work_items=%s\n' "$WORK_ITEM_COUNT"
printf 'runs=%s\n' "$RUN_COUNT"
printf 'approvals=%s\n' "$APPROVAL_COUNT"
