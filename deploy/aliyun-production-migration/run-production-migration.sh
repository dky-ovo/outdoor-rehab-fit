#!/usr/bin/env bash
set -euo pipefail
umask 077

tool_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode="${1-}"
if [[ "$mode" != schema && "$mode" != verify && "$mode" != import ]]; then
  printf '%s\n' 'Usage: run-production-migration.sh schema|verify|import [--source-sha256 HASH --input /absolute/export.jsonl]' >&2
  exit 1
fi
shift
source_sha=''
input_file=''
while (( $# )); do
  case "$1" in
    --source-sha256)
      [[ "$mode" == import && $# -ge 2 && -z "$source_sha" ]] || exit 1
      source_sha="$2"; shift 2 ;;
    --input)
      [[ "$mode" == import && $# -ge 2 && -z "$input_file" ]] || exit 1
      input_file="$2"; shift 2 ;;
    *) printf '%s\n' 'PRODUCTION_ARGUMENTS_INVALID' >&2; exit 1 ;;
  esac
done
if [[ "$mode" == import ]]; then
  [[ "$source_sha" =~ ^[a-f0-9]{64}$ && "$input_file" == /* && -f "$input_file" && ! -L "$input_file" ]] || { printf '%s\n' 'PRODUCTION_SOURCE_REQUIRED' >&2; exit 1; }
  input_file=$(realpath -e -- "$input_file")
  [[ "$input_file" != "$tool_dir"/* && "$input_file" != *$'\n'* && "$input_file" != *$'\r'* ]] || { printf '%s\n' 'PRODUCTION_INPUT_OUTSIDE_BUILD_REQUIRED' >&2; exit 1; }
fi

ca_source='/etc/outdoor-fit/certs/rds-ca-chain.pem'
[[ -f "$ca_source" && -r "$ca_source" ]] || { printf '%s\n' 'PRODUCTION_CA_UNAVAILABLE' >&2; exit 1; }
image_name='outdoor-fit-production-migration:20260924-v1'
docker build --tag "$image_name" "$tool_dir"
container_uid=$(docker run --rm --entrypoint id "$image_name" -u)
[[ "$container_uid" =~ ^[0-9]+$ ]] || { printf '%s\n' 'CONTAINER_USER_INVALID' >&2; exit 1; }
# This sibling run directory is outside the image build context.
run_dir=$(mktemp -d "$(dirname -- "$tool_dir")/production-migration-run.XXXXXXXX")
mkdir -m 0700 "$run_dir/reports" "$run_dir/input"
chown "$container_uid" "$run_dir/reports"
printf 'HOST_REPORT_FILE %s/reports/report.json\n' "$run_dir"

certificate_dir=$(mktemp -d /tmp/outdoor-fit-production-migration.XXXXXXXX)
cleanup() {
  unset MYSQL_PASSWORD
  rm -f -- "$certificate_dir/rds-ca.pem"
  rmdir -- "$certificate_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cat -- "$ca_source" > "$certificate_dir/rds-ca.pem"
chmod 0444 "$certificate_dir/rds-ca.pem"

mounts=()
if [[ "$mode" == import ]]; then
  cp -- "$input_file" "$run_dir/input/export.jsonl"
  chown "$container_uid" "$run_dir/input/export.jsonl"
  chmod 0400 "$run_dir/input/export.jsonl"
  mounts+=(--mount "type=bind,source=$run_dir/input/export.jsonl,target=/input/export.jsonl,readonly")
  command_args=(scripts/import-aliyun-production-data.js --apply --input /input/export.jsonl --source-sha256 "$source_sha")
else
  command_args=(scripts/create-aliyun-production-schema.js)
  if [[ "$mode" == schema ]]; then command_args+=(--apply); else command_args+=(--verify-only); fi
fi
command_args+=(--audit /app/migration/source-schema-audit.json --report /reports/report.json)

IFS= read -r -s -p 'RDS password for outdoor_fit_migrator (production database): ' MYSQL_PASSWORD
printf '\n'
[[ -n "$MYSQL_PASSWORD" ]] || { printf '%s\n' 'PASSWORD_REQUIRED' >&2; exit 1; }
export MYSQL_PASSWORD
run_status=0
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  --memory=1g --memory-swap=1g --cpus=1.5 --pids-limit=128 \
  --mount "type=bind,source=$certificate_dir/rds-ca.pem,target=/run/rds-ca.pem,readonly" \
  --mount "type=bind,source=$run_dir/reports,target=/reports" \
  "${mounts[@]}" \
  --env MYSQL_HOST=rm-3nsog7t39ggxq6qkv.rwlb.cnhk.rds.aliyuncs.com \
  --env MYSQL_PORT=3306 --env MYSQL_USER=outdoor_fit_migrator --env MYSQL_PASSWORD \
  --env MYSQL_DATABASE=outdoor_fit_prod --env MYSQL_SSL_CA=/run/rds-ca.pem \
  "$image_name" "${command_args[@]}" || run_status=$?
printf 'HOST_REPORT_FILE %s/reports/report.json\n' "$run_dir"
exit "$run_status"
