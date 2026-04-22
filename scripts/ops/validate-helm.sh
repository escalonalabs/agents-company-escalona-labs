#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELM_IMAGE="${HELM_IMAGE:-alpine/helm:3.17.3}"
CHART_PATH="${CHART_PATH:-charts/agents-company}"

fail() {
  printf 'validate-helm: %s\n' "$1" >&2
  exit 1
}

run_helm() {
  docker run --rm \
    -v "$ROOT_DIR":/workdir \
    -w /workdir \
    "$HELM_IMAGE" \
    "$@"
}

command -v docker >/dev/null 2>&1 || fail "docker is required."
docker info >/dev/null 2>&1 || fail "docker daemon is not reachable."
[[ -d "$ROOT_DIR/$CHART_PATH" ]] || fail "chart path '$CHART_PATH' does not exist."

printf 'validate-helm: lint default values\n'
run_helm lint "$CHART_PATH"

printf 'validate-helm: lint staging values\n'
run_helm lint "$CHART_PATH" -f "$CHART_PATH/values-staging.yaml"

printf 'validate-helm: lint production values\n'
run_helm lint "$CHART_PATH" -f "$CHART_PATH/values-production.yaml"

printf 'validate-helm: render default values\n'
run_helm template agents-company "$CHART_PATH" >/dev/null

printf 'validate-helm: render staging values\n'
run_helm template agents-company "$CHART_PATH" -f "$CHART_PATH/values-staging.yaml" >/dev/null

printf 'validate-helm: render production values\n'
run_helm template agents-company "$CHART_PATH" -f "$CHART_PATH/values-production.yaml" >/dev/null

printf 'validate-helm: success\n'
