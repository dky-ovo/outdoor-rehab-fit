#!/usr/bin/env bash
set -euo pipefail
umask 077

tool_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
image_name="outdoor-fit-mysql-schema:20260924-v1"
ca_source="/etc/outdoor-fit/certs/rds-ca-chain.pem"
if [[ ! -f "$ca_source" || ! -r "$ca_source" ]]; then
  printf '%s\n' 'CA_FILE_UNAVAILABLE: /etc/outdoor-fit/certs/rds-ca-chain.pem' >&2
  exit 1
fi
docker build --tag "$image_name" "$tool_dir"

certificate_dir=$(mktemp -d /tmp/outdoor-fit-mysql-schema.XXXXXXXX)
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

report_dir=$(mktemp -d "$tool_dir/schema-report.XXXXXXXX")
container_uid=$(docker run --rm --entrypoint id "$image_name" -u)
if [[ ! "$container_uid" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CONTAINER_USER_INVALID' >&2
  exit 1
fi
# Only this newly created private report directory becomes container-writable.
chown "$container_uid" "$report_dir"
printf 'HOST_REPORT_DIR %s\n' "$report_dir"
IFS= read -r -s -p 'RDS password for outdoor_fit_migrator: ' MYSQL_PASSWORD
printf '\n'
if [[ -z "$MYSQL_PASSWORD" ]]; then
  printf '%s\n' 'PASSWORD_REQUIRED' >&2
  exit 1
fi
export MYSQL_PASSWORD

docker run --rm --read-only --cap-drop=ALL --security-opt=no-new-privileges:true \
  --mount "type=bind,source=$certificate_dir/rds-ca.pem,target=/run/rds-ca.pem,readonly" \
  --mount "type=bind,source=$report_dir,target=/reports" \
  --env MYSQL_HOST=rm-3nsog7t39ggxq6qkv.rwlb.cnhk.rds.aliyuncs.com \
  --env MYSQL_PORT=3306 \
  --env MYSQL_USER=outdoor_fit_migrator \
  --env MYSQL_PASSWORD \
  --env MYSQL_DATABASE=outdoor_fit_test \
  --env MYSQL_SSL_CA=/run/rds-ca.pem \
  "$image_name"

printf 'HOST_REPORT_FILE %s/schema-report.json\n' "$report_dir"
