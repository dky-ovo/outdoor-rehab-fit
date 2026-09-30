#!/usr/bin/env bash
# Prepare empty production paths; this does not start containers or move data.
set -euo pipefail
umask 077

base=/opt/outdoor-fit/production
ca=/etc/outdoor-fit/certs/rds-ca-chain.pem

if [[ $(id -u) != 0 ]]; then
  printf '%s\n' 'PREPARE_REQUIRES_ROOT' >&2
  exit 1
fi
for command in docker openssl install; do
  command -v "$command" >/dev/null
done
docker compose version >/dev/null
if [[ ! -f "$ca" || ! -r "$ca" ]]; then
  printf '%s\n' 'RDS_CA_UNAVAILABLE' >&2
  exit 1
fi
openssl x509 -in "$ca" -noout >/dev/null

# Do not follow pre-existing links or change the owner/mode of existing paths.
for directory in /opt /opt/outdoor-fit "$base"; do
  if [[ -L "$directory" || ( -e "$directory" && ! -d "$directory" ) ]]; then
    printf '%s\n' 'PRODUCTION_PATH_INVALID' >&2
    exit 1
  fi
done
if [[ ! -d "$base" ]]; then install -d -m 0700 -- "$base"; fi
for relative in config secrets releases state state/equipment-images state/media-library state/media-seed state/caddy-data state/caddy-config web; do
  directory="$base/$relative"
  if [[ -L "$directory" || ( -e "$directory" && ! -d "$directory" ) ]]; then
    printf '%s\n' 'PRODUCTION_PATH_INVALID' >&2
    exit 1
  fi
  if [[ ! -d "$directory" ]]; then
    case "$relative" in
      state/*|web) install -d -m 0750 -o 1000 -g 1000 -- "$directory" ;;
      *) install -d -m 0700 -- "$directory" ;;
    esac
  fi
done
certificate_copy="$base/config/rds-ca-chain.pem"
if [[ -L "$certificate_copy" || ( -e "$certificate_copy" && ! -f "$certificate_copy" ) ]]; then
  printf '%s\n' 'PRODUCTION_CA_PATH_INVALID' >&2
  exit 1
fi
if [[ ! -e "$certificate_copy" ]]; then
  # CA certificates are public trust material, not a server private key.
  install -m 0444 -- "$ca" "$certificate_copy"
fi
printf 'PRODUCTION_ROOT=%s\n' "$base"
printf '%s\n' 'HOST_PREPARATION=COMPLETE'
