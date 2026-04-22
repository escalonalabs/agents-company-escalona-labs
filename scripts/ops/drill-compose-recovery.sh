#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT_DIR")}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-}"
GITHUB_APP_URL="${GITHUB_APP_URL:-}"
CONTROL_WEB_URL="${CONTROL_WEB_URL:-}"
GITHUB_APP_EXPECTED_STATUS="${GITHUB_APP_EXPECTED_STATUS:-ok}"
RECOVERY_TIMEOUT_SECONDS="${RECOVERY_TIMEOUT_SECONDS:-120}"

fail() {
  printf 'drill-compose-recovery: %s\n' "$1" >&2
  exit 1
}

wait_for_json_status() {
  local url="$1"
  local expected_status="$2"
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    if python3 - "$url" "$expected_status" <<'PY'
import json
import sys
import urllib.request

url, expected = sys.argv[1], sys.argv[2]

try:
    with urllib.request.urlopen(url, timeout=5) as response:
        payload = json.load(response)
except Exception:
    sys.exit(1)

sys.exit(0 if payload.get("status") == expected else 1)
PY
    then
      return 0
    fi
    sleep 2
  done

  fail "timed out waiting for $url to report status '$expected_status'."
}

wait_for_plain_ok() {
  local url="$1"
  local deadline=$((SECONDS + RECOVERY_TIMEOUT_SECONDS))

  while (( SECONDS < deadline )); do
    if [[ "$(curl -fsS "$url" 2>/dev/null)" == "ok" ]]; then
      return 0
    fi
    sleep 2
  done

  fail "timed out waiting for $url to return ok."
}

compose_port_url() {
  local service="$1"
  local container_port="$2"
  local path="$3"
  local mapping

  mapping="$(
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$ROOT_DIR/docker-compose.yml" port "$service" "$container_port" 2>/dev/null | tail -n 1
  )"
  [[ -n "$mapping" ]] || fail "could not resolve published port for service '$service:$container_port'."

  printf 'http://127.0.0.1:%s%s\n' "${mapping##*:}" "$path"
}

assert_stack_running() {
  local running_services
  running_services="$(
    docker compose -p "$COMPOSE_PROJECT_NAME" -f "$ROOT_DIR/docker-compose.yml" ps --services --status running
  )"

  [[ "$running_services" == *"control-plane"* ]] || fail "control-plane is not running in compose project '$COMPOSE_PROJECT_NAME'."
  [[ "$running_services" == *"github-app"* ]] || fail "github-app is not running in compose project '$COMPOSE_PROJECT_NAME'."
  [[ "$running_services" == *"control-web"* ]] || fail "control-web is not running in compose project '$COMPOSE_PROJECT_NAME'."
}

command -v docker >/dev/null 2>&1 || fail "docker is required."
docker info >/dev/null 2>&1 || fail "docker daemon is not reachable."
command -v curl >/dev/null 2>&1 || fail "curl is required."
command -v python3 >/dev/null 2>&1 || fail "python3 is required."

assert_stack_running

if [[ -z "$CONTROL_PLANE_URL" ]]; then
  CONTROL_PLANE_URL="$(compose_port_url control-plane 3000 /health)"
fi

if [[ -z "$GITHUB_APP_URL" ]]; then
  GITHUB_APP_URL="$(compose_port_url github-app 3001 /health)"
fi

if [[ -z "$CONTROL_WEB_URL" ]]; then
  CONTROL_WEB_URL="$(compose_port_url control-web 80 /web-health)"
fi

docker compose -p "$COMPOSE_PROJECT_NAME" -f "$ROOT_DIR/docker-compose.yml" restart \
  control-plane github-app control-web >/dev/null

wait_for_json_status "$CONTROL_PLANE_URL" "ok"
wait_for_json_status "$GITHUB_APP_URL" "$GITHUB_APP_EXPECTED_STATUS"
wait_for_plain_ok "$CONTROL_WEB_URL"

printf 'compose_project=%s\n' "$COMPOSE_PROJECT_NAME"
printf 'control_plane=%s\n' "$CONTROL_PLANE_URL"
printf 'github_app=%s\n' "$GITHUB_APP_URL"
printf 'control_web=%s\n' "$CONTROL_WEB_URL"
