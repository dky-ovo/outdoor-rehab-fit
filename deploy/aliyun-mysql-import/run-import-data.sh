#!/usr/bin/env bash
set -euo pipefail
umask 077

tool_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
migration_dir="/opt/outdoor-fit/migration/20260924-rehearsal"
source_file="$migration_dir/outdoor-fit.sqlite"
source_sha="9e01e2f4d5b0e05cb0dac415ccffa4179e42105a76efc42df7e3788c9e46933d"
ca_source="/etc/outdoor-fit/certs/rds-ca-chain.pem"
image_name="outdoor-fit-mysql-import:20260924-v1"

if [[ ! -f "$source_file" || -L "$source_file" || ! -f "$ca_source" || ! -r "$ca_source" ]]; then
  printf '%s\n' 'IMPORT_SOURCE_OR_CA_UNAVAILABLE' >&2
  exit 1
fi
printf '%s  %s\n' "$source_sha" "$source_file" | sha256sum -c -
command -v python3 >/dev/null
docker build --tag "$image_name" "$tool_dir"

# Data stays in a new private sibling directory, outside the Docker build context.
run_dir=$(mktemp -d "$migration_dir/import-run.XXXXXXXX")
mkdir -m 0700 "$run_dir/input" "$run_dir/reports"
printf 'HOST_RUN_DIR %s\n' "$run_dir"
python3 "$tool_dir/export-aliyun-sqlite.py" \
  --database "$source_file" --output "$run_dir/input/export.jsonl"
sha256sum "$run_dir/input/export.jsonl"

container_uid=$(docker run --rm --entrypoint id "$image_name" -u)
if [[ ! "$container_uid" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CONTAINER_USER_INVALID' >&2
  exit 1
fi
chown "$container_uid" "$run_dir/input/export.jsonl" "$run_dir/reports"
chmod 0400 "$run_dir/input/export.jsonl"
printf 'HOST_REPORT_FILE %s/reports/import-report.json\n' "$run_dir"

certificate_dir=$(mktemp -d /tmp/outdoor-fit-mysql-import.XXXXXXXX)
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

IFS= read -r -s -p 'RDS password for outdoor_fit_migrator: ' MYSQL_PASSWORD
printf '\n'
if [[ -z "$MYSQL_PASSWORD" ]]; then
  printf '%s\n' 'PASSWORD_REQUIRED' >&2
  exit 1
fi
export MYSQL_PASSWORD

run_status=0
docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  --memory=1g --memory-swap=1g --cpus=1.5 --pids-limit=128 \
  --mount "type=bind,source=$certificate_dir/rds-ca.pem,target=/run/rds-ca.pem,readonly" \
  --mount "type=bind,source=$run_dir/input/export.jsonl,target=/input/export.jsonl,readonly" \
  --mount "type=bind,source=$run_dir/reports,target=/reports" \
  --env MYSQL_HOST=rm-3nsog7t39ggxq6qkv.rwlb.cnhk.rds.aliyuncs.com \
  --env MYSQL_PORT=3306 \
  --env MYSQL_USER=outdoor_fit_migrator \
  --env MYSQL_PASSWORD \
  --env MYSQL_DATABASE=outdoor_fit_test \
  --env MYSQL_SSL_CA=/run/rds-ca.pem \
  "$image_name" || run_status=$?

printf 'HOST_REPORT_FILE %s/reports/import-report.json\n' "$run_dir"
exit "$run_status"
