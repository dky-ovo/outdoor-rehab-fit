#!/usr/bin/env bash
# Add the browser App host to the confirmed, currently mounted v2 web release.
set -euo pipefail
umask 077

release=/opt/outdoor-fit/production/releases/outdoor-fit-production-20260924-v2
config="$release/deploy/aliyun-production/Caddyfile"
compose_file="$release/deploy/aliyun-production/compose.yaml"
env_file=/opt/outdoor-fit/production/secrets/production.env
compose=(docker compose --env-file "$env_file" -f "$compose_file")
cd "$release/deploy/aliyun-production"

for executable in docker python3 curl flock; do command -v "$executable" >/dev/null; done
exec 9>/opt/outdoor-fit/production/.app-domain.lock
flock -n 9 || { echo APP_DOMAIN_UPDATE_ALREADY_RUNNING; exit 1; }

# Inspect only; do not display Docker environment variables or the Compose JSON.
python3 - "$release" "$config" "$compose_file" "$env_file" <<'PY'
import json, pathlib, socket, subprocess, sys
release, config, compose_file, env_file = sys.argv[1:]
def check(value, code):
    if not value: raise SystemExit(code)
def read(args):
    p = subprocess.run(args, capture_output=True, text=True, timeout=30)
    check(p.returncode == 0, 'APP_PREFLIGHT_COMMAND_FAILED')
    return json.loads(p.stdout)
caddy = read(['docker', 'inspect', 'outdoor-fit-production-caddy-1'])[0]
check(caddy['State']['Running'], 'CADDY_NOT_RUNNING')
labels = caddy['Config']['Labels']
check(labels.get('com.docker.compose.project') == 'outdoor-fit-production'
      and labels.get('com.docker.compose.service') == 'caddy'
      and labels.get('com.docker.compose.project.config_files') == compose_file,
      'CADDY_RELEASE_CHANGED')
mounts = {x['Destination']: x for x in caddy['Mounts']}
expected = {'/etc/caddy/Caddyfile': config, '/srv/admin': release + '/web'}
for target, source in expected.items():
    check(mounts.get(target, {}).get('Type') == 'bind'
          and mounts[target]['Source'] == source, 'CADDY_MOUNT_CHANGED')
check(pathlib.Path(release + '/web/index.html').is_file(), 'APP_WEB_INDEX_MISSING')
cfg = read(['docker', 'compose', '--env-file', env_file, '-f', compose_file,
            'config', '--format', 'json'])
service = cfg['services']['caddy']
volumes = {x['target']: x for x in service['volumes']}
for target, source in expected.items():
    check(volumes.get(target, {}).get('source') == source, 'COMPOSE_MOUNT_CHANGED')
image = read(['docker', 'image', 'inspect', service['image']])[0]
check(image['Id'] == caddy['Image'], 'CADDY_IMAGE_CHANGED')
try:
    addresses = {x[4][0] for x in socket.getaddrinfo('app.outdoorfit.hk', 443, type=socket.SOCK_STREAM)}
except OSError:
    raise SystemExit('APP_DNS_LOOKUP_FAILED')
check(addresses == {'47.83.186.36'}, 'APP_DNS_REQUIRES_REVIEW')
print('APP_DOMAIN_PREFLIGHT=PASS')
PY

api_before=$(docker inspect --format '{{.Id}} {{.State.StartedAt}}' outdoor-fit-production-api-1)
work=$(mktemp -d /opt/outdoor-fit/production/app-domain-20260928.XXXXXXXX)
printf 'BACKUP_DIR=%s\n' "$work"

python3 - "$config" "$work" <<'PY'
from pathlib import Path
import shutil, sys
source, work = Path(sys.argv[1]), Path(sys.argv[2])
if source.is_symlink() or not source.is_file(): raise SystemExit('CADDY_REGULAR_FILE_REQUIRED')
original = source.read_bytes()
if b'app.outdoorfit.hk' in original:
    raise SystemExit('APP_HOST_ALREADY_PRESENT_NO_CHANGES')
shutil.copy2(source, work / 'original.caddy')
block = b'''

# Browser App entry, added 2026-09-28.
app.outdoorfit.hk {
    encode zstd gzip
    @api path /api /api/*
    handle @api {
        reverse_proxy api:3000
    }
    handle {
        root * /srv/admin
        try_files {path} /index.html
        header Cache-Control "no-cache"
        file_server
    }
}
'''
candidate = work / 'candidate.caddy'
candidate.write_bytes(original + block)
candidate.chmod(0o644)
print('APP_DOMAIN_CANDIDATE=READY')
PY

"${compose[@]}" run --rm --no-deps --pull never --entrypoint caddy \
  --volume "$work/candidate.caddy:/etc/caddy/Caddyfile:ro" \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

replace_config() {
  python3 - "$1" "$config" <<'PY'
import os, pathlib, stat, sys, tempfile
source, target = map(pathlib.Path, sys.argv[1:])
before = target.stat()
fd, temporary = tempfile.mkstemp(prefix='.Caddyfile.app-', dir=target.parent)
try:
    with os.fdopen(fd, 'wb') as handle:
        handle.write(source.read_bytes())
        handle.flush()
        os.fsync(handle.fileno())
        os.fchmod(handle.fileno(), stat.S_IMODE(before.st_mode))
        os.fchown(handle.fileno(), before.st_uid, before.st_gid)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
}

activated=0
rollback() {
  result=$?
  trap - ERR
  set +e
  echo APP_DOMAIN_ENABLE=FAILED
  if [[ "$activated" == 1 ]]; then
    if cmp -s "$config" "$work/candidate.caddy"; then
      if replace_config "$work/original.caddy" && \
        "${compose[@]}" up -d --no-deps --no-build --pull never --force-recreate caddy; then
        echo CADDY_CONFIG_ROLLBACK=COMPLETE
      else
        echo CADDY_CONFIG_ROLLBACK=FAILED
      fi
    else
      echo CADDY_CONFIG_CHANGED_EXTERNALLY_ROLLBACK_SKIPPED
    fi
  fi
  printf 'BACKUP_DIR=%s\n' "$work"
  exit "$result"
}
trap rollback ERR
cmp -s "$config" "$work/original.caddy"
replace_config "$work/candidate.caddy"
activated=1
"${compose[@]}" up -d --no-deps --no-build --pull never --force-recreate caddy

# First certificate issuance can take a short while. Keep normal TLS validation.
curl --fail --silent --show-error --compressed \
  --retry 15 --retry-all-errors --retry-delay 3 --retry-max-time 120 \
  --connect-timeout 5 --max-time 10 \
  --output "$work/app-index.html" https://app.outdoorfit.hk/
cmp -s "$work/app-index.html" "$release/web/index.html"
curl --fail --silent --show-error --max-time 15 https://app.outdoorfit.hk/api/health \
  --output "$work/health.json"
python3 - "$work/health.json" <<'PY'
import json, sys
with open(sys.argv[1]) as f: value = json.load(f)
if value.get('ok') is not True or value.get('service') != 'outdoor-fit-api':
    raise SystemExit('APP_API_HEALTH_FAILED')
PY
curl --fail --silent --show-error --max-time 15 --output /dev/null https://api.outdoorfit.hk/api/health
curl --fail --silent --show-error --max-time 15 --output /dev/null https://admin.outdoorfit.hk/admin
api_after=$(docker inspect --format '{{.Id}} {{.State.StartedAt}}' outdoor-fit-production-api-1)
test "$api_before" = "$api_after"
trap - ERR
printf 'APP_HTTPS=PASS\nAPP_WEB_INDEX=PASS\nAPP_API=PASS\nAPI_CONTAINER_UNCHANGED=PASS\nAPP_DOMAIN_ENABLE=COMPLETE\nAPP_URL=https://app.outdoorfit.hk\n'
