#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TERRAFORM_IMAGE="${TERRAFORM_IMAGE:-hashicorp/terraform:1.12.2}"
TERRAFORM_DIR="${TERRAFORM_DIR:-infra/aws}"
TF_DATA_HOST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/agents-company-tfdata.XXXXXX")"
TF_DATA_HOST_PARENT="$(dirname "$TF_DATA_HOST_DIR")"
TF_DATA_HOST_BASENAME="$(basename "$TF_DATA_HOST_DIR")"

fail() {
  printf 'validate-aws-infra: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is required."
docker info >/dev/null 2>&1 || fail "docker daemon is not reachable."
[[ -d "$ROOT_DIR/$TERRAFORM_DIR" ]] || fail "terraform directory '$TERRAFORM_DIR' does not exist."

cleanup() {
  docker run --rm \
    -v "$TF_DATA_HOST_PARENT":/tmp-root \
    alpine:3.21 \
    sh -lc "rm -rf /tmp-root/$TF_DATA_HOST_BASENAME" >/dev/null 2>&1 || true
  docker run --rm \
    -v "$ROOT_DIR":/workdir \
    alpine:3.21 \
    sh -lc "rm -rf /workdir/$TERRAFORM_DIR/.terraform" >/dev/null 2>&1 || true
}

trap cleanup EXIT

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --entrypoint sh \
  -v "$ROOT_DIR":/workdir \
  -v "$TF_DATA_HOST_DIR":/terraform-data \
  -w /workdir \
  "$TERRAFORM_IMAGE" \
  -lc "
    terraform -chdir=$TERRAFORM_DIR fmt -check &&
    TF_DATA_DIR=/terraform-data terraform -chdir=$TERRAFORM_DIR init -backend=false &&
    TF_DATA_DIR=/terraform-data terraform -chdir=$TERRAFORM_DIR validate
  "

printf 'validate-aws-infra: success\n'
