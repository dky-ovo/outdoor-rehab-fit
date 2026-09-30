#!/usr/bin/env python3
"""Add the public website to the existing Caddy service; never change the API."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import time

BASE = Path('/opt/outdoor-fit/production')
TAG = 'public-website-20260928-v1'
STATE = BASE / '.update-state' / TAG
RELEASE = BASE / 'releases' / TAG
PACKAGE = Path(__file__).resolve().parent
WEBSITE = PACKAGE / 'website'
CADDY = 'outdoor-fit-production-caddy-1'
API = 'outdoor-fit-production-api-1'
PROJECT = 'outdoor-fit-production'
DIAGNOSTICS_ENABLED = False
BLOCK = '''

# Public website, independently released 2026-09-28.
(outdoor_public_site_20260928) {
    encode zstd gzip
    root * /srv/website
    header X-Content-Type-Options nosniff
    header Referrer-Policy strict-origin-when-cross-origin
    @html path / *.html
    header @html Cache-Control "no-cache"
    file_server
}

outdoorfit.hk {
    import outdoor_public_site_20260928
}

www.outdoorfit.hk {
    redir https://outdoorfit.hk{uri} 308
}

# Internal probe only: bound inside the container, never published on the host.
http://:8099 {
    bind 127.0.0.1
    @website host outdoorfit.hk
    handle @website {
        import outdoor_public_site_20260928
    }
    handle {
        respond "Not found" 404
    }
}
'''


class Failure(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Failure(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def command(args, timeout=120, data=None, error='WEBSITE_COMMAND_FAILED'):
    """Never echo commands/configuration/errors that may contain resolved secrets."""
    result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
    if result.returncode:
        if DIAGNOSTICS_ENABLED and STATE.is_dir():
            with (STATE / 'diagnostics.log').open('ab') as stream:
                stream.write((error + '\n').encode() + result.stdout + result.stderr + b'\n')
        raise Failure(error)
    return result.stdout


def inspect(name):
    return json.loads(command(['docker', 'inspect', name]))[0]


def api_identity():
    value = inspect(API)
    require(value['State']['Running'], 'WEBSITE_API_NOT_RUNNING')
    return {'id': value['Id'], 'startedAt': value['State']['StartedAt']}


def regular(path, code, under=None):
    require(path.is_file() and not path.is_symlink(), code)
    if under:
        require(under.resolve() in path.resolve().parents, code)
    return path


def website_files():
    require(WEBSITE.is_dir() and not WEBSITE.is_symlink(), 'WEBSITE_SOURCE_MISSING')
    manifest_file = regular(PACKAGE / 'website-manifest.json', 'WEBSITE_MANIFEST_MISSING')
    manifest = json.loads(manifest_file.read_text(encoding='utf-8'))
    require(manifest.get('format') == 1 and isinstance(manifest.get('files'), dict), 'WEBSITE_MANIFEST_INVALID')
    files = manifest['files']
    require('index.html' in files and 0 < len(files) <= 10000, 'WEBSITE_INDEX_REQUIRED')
    actual = set()
    for path in WEBSITE.rglob('*'):
        require(not path.is_symlink(), 'WEBSITE_SYMLINK_REJECTED')
        if path.is_dir():
            continue
        relative = path.relative_to(WEBSITE).as_posix()
        safe_relative(relative)
        require(path.is_file(), 'WEBSITE_SPECIAL_FILE_REJECTED')
        actual.add(relative)
    require(actual == set(files), 'WEBSITE_MANIFEST_FILESET_MISMATCH')
    total = 0
    for name, entry in files.items():
        safe_relative(name)
        require(isinstance(entry, dict) and re.fullmatch('[a-f0-9]{64}', entry.get('sha256', ''))
                and isinstance(entry.get('bytes'), int) and entry['bytes'] >= 0, 'WEBSITE_MANIFEST_INVALID')
        path = regular(WEBSITE.joinpath(*PurePosixPath(name).parts), 'WEBSITE_FILE_INVALID', WEBSITE)
        data = path.read_bytes()
        require(len(data) == entry['bytes'] and digest(data) == entry['sha256'], 'WEBSITE_FILE_HASH_MISMATCH')
        total += len(data)
    require(total <= 1024 * 1024 * 1024, 'WEBSITE_PACKAGE_TOO_LARGE')
    return files


def safe_relative(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name
            and not any(ord(char) < 32 for char in name), 'WEBSITE_PATH_INVALID')
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and path.as_posix() == name,
            'WEBSITE_PATH_INVALID')
    for part in path.parts:
        lower = part.lower()
        require(not lower.startswith('.') and lower not in
                {'secrets', 'credentials', 'id_rsa', 'id_ed25519', 'node_modules'}, 'WEBSITE_PRIVATE_PATH_REJECTED')
    require(path.suffix.lower() not in {'.pem', '.key', '.sqlite', '.db', '.py', '.sh', '.ps1', '.map'},
            'WEBSITE_PRIVATE_FILE_REJECTED')


def compose(path, *arguments):
    # --no-interpolate preserves literal dollar signs in captured environment values.
    # Saved JSON doubles dollars below so normal Compose calls round-trip them.
    return ['docker', 'compose', '--project-name', PROJECT, '-f', str(path), *arguments]


def literal_compose(value):
    if isinstance(value, str):
        return value.replace('$', '$$')
    if isinstance(value, list):
        return [literal_compose(item) for item in value]
    if isinstance(value, dict):
        return {key: literal_compose(item) for key, item in value.items()}
    return value


def save_json(name, value, compose_document=False):
    path = STATE / name
    path.write_text(json.dumps(literal_compose(value) if compose_document else value, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)
    return path


def capture():
    live = inspect(CADDY)
    require(live['State']['Running'], 'WEBSITE_CADDY_NOT_RUNNING')
    labels = live['Config']['Labels']
    require(labels.get('com.docker.compose.project') == PROJECT
            and labels.get('com.docker.compose.service') == 'caddy', 'WEBSITE_CADDY_PROJECT_MISMATCH')
    args = ['docker', 'compose', '--env-file', str(BASE / 'secrets/production.env')]
    for name in labels['com.docker.compose.project.config_files'].split(','):
        path = regular(Path(name), 'WEBSITE_COMPOSE_PATH_INVALID', BASE)
        args += ['-f', str(path)]
    config = json.loads(command(args + ['config', '--format', 'json']))
    service = config['services']['caddy']
    require(service.get('user') == '1000:1000', 'WEBSITE_CADDY_USER_CHANGED')
    live_environment = dict(item.split('=', 1) for item in live['Config'].get('Env', []) if '=' in item)
    for key, value in service.get('environment', {}).items():
        require(live_environment.get(key) == str(value), 'WEBSITE_CADDY_ENVIRONMENT_DRIFT')
    image = json.loads(command(['docker', 'image', 'inspect', service['image']]))[0]
    require(image['Id'] == live['Image'], 'WEBSITE_CADDY_IMAGE_DRIFT')
    mounts = {item['Destination']: item for item in live['Mounts']}
    for volume in service.get('volumes', []):
        if volume['type'] == 'bind':
            mounted = mounts.get(volume['target'], {})
            require(mounted.get('Type') == 'bind' and mounted.get('Source') == volume['source']
                    and mounted.get('RW') == (not volume.get('read_only', False)), 'WEBSITE_CADDY_MOUNT_DRIFT')
    require('/srv/website' not in mounts, 'WEBSITE_ALREADY_MOUNTED')
    require('/etc/caddy/Caddyfile' in mounts and '/srv/admin' in mounts, 'WEBSITE_EXPECTED_MOUNTS_MISSING')
    source = regular(Path(mounts['/etc/caddy/Caddyfile']['Source']), 'WEBSITE_CADDYFILE_INVALID', BASE)
    original = source.read_bytes()
    mounted_bytes = command(['docker', 'exec', CADDY, 'cat', '/etc/caddy/Caddyfile'])
    require(mounted_bytes == original, 'WEBSITE_CADDYFILE_MOUNT_CONTENT_DRIFT')
    text = original.decode('utf-8')
    # Reject imports rather than silently overlooking an apex route in another file.
    clean = '\n'.join(line.split('#', 1)[0] for line in text.splitlines())
    require(not re.search(r'^\s*import\s', clean, re.MULTILINE), 'WEBSITE_EXISTING_IMPORT_REQUIRES_REVIEW')
    require(not re.search(r'(?<![\w.-])(?:www\.)?outdoorfit\.hk(?=[\s,:/{]|$)', clean), 'WEBSITE_APEX_ALREADY_CONFIGURED')
    require('8099' not in clean and 'outdoor_public_site_20260928' not in clean,
            'WEBSITE_PROBE_COLLISION')
    require(not re.search(r'\*\.outdoorfit\.hk', clean), 'WEBSITE_WILDCARD_REQUIRES_REVIEW')
    require(not any(str(port.get('target')) == '8099' for port in service.get('ports', [])),
            'WEBSITE_PROBE_ALREADY_EXPOSED')
    return live, config, source, original


def up(path):
    command(compose(path, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                    '--force-recreate', 'caddy'), timeout=120, error='WEBSITE_CADDY_START_FAILED')


def retry(operation, attempts=12):
    last = None
    for attempt in range(attempts):
        try:
            return operation()
        except (Failure, subprocess.TimeoutExpired) as error:
            last = error
            if attempt + 1 < attempts:
                time.sleep(2)
    raise last


def verify_local(expected):
    result = command(['docker', 'exec', CADDY, 'wget', '-q', '-O', '-',
                      '--header=Host: outdoorfit.hk', 'http://127.0.0.1:8099/'],
                     timeout=10, error='WEBSITE_LOCAL_PROBE_FAILED')
    require(digest(result) == expected, 'WEBSITE_LOCAL_INDEX_MISMATCH')


def verify_existing(expected=None):
    hashes = {}
    for url in ['https://api.outdoorfit.hk/api/health', 'https://app.outdoorfit.hk/',
                'https://admin.outdoorfit.hk/admin']:
        data = command(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', url],
                       timeout=20, error='WEBSITE_EXISTING_HOST_CHECK_FAILED')
        if url.endswith('/api/health'):
            value = json.loads(data)
            require(value.get('ok') is True and value.get('service') == 'outdoor-fit-api',
                    'WEBSITE_EXISTING_API_UNHEALTHY')
        else:
            require(b'<html' in data.lower(), 'WEBSITE_EXISTING_APP_RESPONSE_INVALID')
            hashes[url] = digest(data)
    if expected is not None:
        require(hashes == expected, 'WEBSITE_EXISTING_APP_CONTENT_CHANGED')
    return hashes


def verify_https():
    report = json.loads(regular(STATE / 'report.json', 'WEBSITE_INSTALL_REPORT_MISSING').read_text())
    require(report.get('status') == 'complete', 'WEBSITE_INSTALL_NOT_COMPLETE')
    expected = report['indexSha256']
    body = command(['curl', '--fail', '--silent', '--show-error', '--max-time', '20',
                    'https://outdoorfit.hk/'], timeout=25, error='WEBSITE_HTTPS_APEX_FAILED')
    require(digest(body) == expected, 'WEBSITE_HTTPS_INDEX_MISMATCH')
    headers = command(['curl', '--silent', '--show-error', '--head', '--max-time', '20',
                       'https://www.outdoorfit.hk/'], timeout=25, error='WEBSITE_HTTPS_WWW_FAILED').decode()
    require(re.search(r'^HTTP/\S+ 308\b', headers, re.MULTILINE)
            and re.search(r'^location:\s*https://outdoorfit\.hk/\s*$', headers, re.MULTILINE | re.IGNORECASE),
            'WEBSITE_WWW_REDIRECT_INVALID')
    verify_existing()
    report['httpsVerified'] = True
    save_json('report.json', report)
    print('WEBSITE_HTTPS=PASS\nWEBSITE_URL=https://outdoorfit.hk', flush=True)


def install(check_only=False):
    global DIAGNOSTICS_ENABLED
    import fcntl
    require(os.geteuid() == 0, 'WEBSITE_ROOT_REQUIRED')
    require(BASE.is_dir() and not BASE.is_symlink(), 'WEBSITE_PRODUCTION_BASE_INVALID')
    files = website_files()
    before = api_identity()
    live, config, source, original = capture()
    if check_only:
        print('WEBSITE_READ_ONLY_PREFLIGHT=PASS\nWEBSITE_FILE_COUNT=' + str(len(files)))
        return
    with (BASE / '.public-website.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not STATE.exists() and not RELEASE.exists(), 'WEBSITE_RELEASE_ALREADY_EXISTS_REVIEW_STATE')
        require(inspect(CADDY)['Id'] == live['Id'] and source.read_bytes() == original
                and api_identity() == before, 'WEBSITE_LIVE_STATE_CHANGED')
        STATE.mkdir(mode=0o700, parents=True)
        STATE.chmod(0o700)
        DIAGNOSTICS_ENABLED = True
        RELEASE.mkdir(mode=0o755, parents=True)
        RELEASE.chmod(0o755)
        print('WEBSITE_STATE_DIR=' + str(STATE), flush=True)
        for name, entry in files.items():
            origin = WEBSITE.joinpath(*PurePosixPath(name).parts)
            target = RELEASE / 'website' / name
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            shutil.copyfile(origin, target)
            target.chmod(0o644)
            require(digest(target.read_bytes()) == entry['sha256'], 'WEBSITE_STAGE_HASH_MISMATCH')
        for directory, _, _ in os.walk(RELEASE):
            Path(directory).chmod(0o755)
        candidate = RELEASE / 'Caddyfile'
        candidate.write_bytes(original + BLOCK.encode())
        os.chown(candidate, 1000, 1000)
        candidate.chmod(0o600)
        (STATE / 'original.caddy').write_bytes(original)
        old_path = save_json('rollback-caddy.json', config, compose_document=True)
        proposed = copy.deepcopy(config)
        volumes = proposed['services']['caddy']['volumes']
        require(sum(v['target'] == '/etc/caddy/Caddyfile' for v in volumes) == 1,
                'WEBSITE_CADDY_MOUNT_COUNT_INVALID')
        for volume in volumes:
            if volume['target'] == '/etc/caddy/Caddyfile':
                volume['source'] = str(candidate)
        volumes.append({'type': 'bind', 'source': str(RELEASE / 'website'), 'target': '/srv/website',
                        'read_only': True, 'bind': {'create_host_path': False}})
        new_path = save_json('caddy.json', proposed, compose_document=True)
        save_json('report.json', {'status': 'staged', 'indexSha256': files['index.html']['sha256'],
                                 'apiBefore': before, 'httpsVerified': False})
        rollback_command = compose(old_path, 'up', '-d', '--no-deps', '--no-build', '--pull',
                                   'never', '--force-recreate', 'caddy')
        rollback_script = ('#!/bin/bash\nset -euo pipefail\numask 077\n'
                           + "current_config=$(docker inspect --format '{{ index .Config.Labels \"com.docker.compose.project.config_files\" }}' "
                           + shlex.quote(CADDY) + ' 2>/dev/null || true)\n'
                           + 'if [[ -n "$current_config" && "$current_config" != '
                           + shlex.quote(str(new_path)) + ' && "$current_config" != '
                           + shlex.quote(str(old_path)) + ' ]]; then\n'
                           + "  printf 'WEBSITE_MANUAL_ROLLBACK=STOPPED_LATER_DEPLOYMENT_PRESENT\\n'\n  exit 1\nfi\n"
                           + 'if ! ' + shlex.join(rollback_command) + ' >> '
                           + shlex.quote(str(STATE / 'manual-rollback.log')) + ' 2>&1; then\n'
                           + "  printf 'WEBSITE_MANUAL_ROLLBACK=FAILED_REVIEW_PRIVATE_LOG\\n'\n  exit 1\nfi\n"
                           + "printf 'WEBSITE_MANUAL_ROLLBACK=COMPLETE\\n'\n")
        (STATE / 'rollback.sh').write_text(rollback_script)
        (STATE / 'rollback.sh').chmod(0o700)
        print('WEBSITE_ROLLBACK=' + str(STATE / 'rollback.sh'), flush=True)
        for path, expected in [(old_path, config), (new_path, proposed)]:
            resolved = json.loads(command(compose(path, 'config', '--format', 'json')))
            require(resolved['services']['caddy'] == expected['services']['caddy'],
                    'WEBSITE_COMPOSE_ROUNDTRIP_MISMATCH')
        command(compose(new_path, 'run', '--rm', '--no-deps', '--pull', 'never', '--entrypoint',
                        'caddy', 'caddy', 'validate', '--config', '/etc/caddy/Caddyfile',
                        '--adapter', 'caddyfile'), error='WEBSITE_CADDY_VALIDATION_FAILED')
        existing_hashes = verify_existing()
        require(inspect(CADDY)['Id'] == live['Id'] and source.read_bytes() == original
                and api_identity() == before, 'WEBSITE_LIVE_STATE_CHANGED')
        print('WEBSITE_CANDIDATE=VALIDATED', flush=True)
        activated = False
        try:
            activated = True
            up(new_path)
            retry(lambda: verify_local(files['index.html']['sha256']))
            retry(lambda: verify_existing(existing_hashes), attempts=3)
            require(api_identity() == before, 'WEBSITE_API_CONTAINER_CHANGED')
            save_json('report.json', {'status': 'complete', 'indexSha256': files['index.html']['sha256'],
                                     'apiBefore': before, 'existingHashes': existing_hashes,
                                     'httpsVerified': False})
        except BaseException:
            if activated:
                print('WEBSITE_PHASE=ROLLBACK', flush=True)
                try:
                    observed = subprocess.run(['docker', 'inspect', CADDY], capture_output=True, timeout=20)
                    if observed.returncode == 0:
                        current = json.loads(observed.stdout)[0]
                        current_sources = {item['Destination']: item['Source'] for item in current['Mounts']}
                        require(current_sources.get('/etc/caddy/Caddyfile') in {str(candidate), str(source)},
                                'WEBSITE_EXTERNAL_CHANGE_ROLLBACK_STOPPED')
                    up(old_path)
                    require(api_identity() == before, 'WEBSITE_ROLLBACK_API_CHANGED')
                    retry(lambda: verify_existing(existing_hashes), attempts=3)
                    print('WEBSITE_ROLLBACK=COMPLETE', flush=True)
                except BaseException:
                    print('WEBSITE_ROLLBACK=FAILED_USE_SAVED_SCRIPT', flush=True)
            raise
        print('WEBSITE_LOCAL_INDEX=PASS\nWEBSITE_EXISTING_HOSTS=PASS\n'
              'WEBSITE_API_CONTAINER_UNCHANGED=PASS\nWEBSITE_INSTALL=PASS\n'
              'WEBSITE_PUBLIC_HTTPS=NOT_YET_VERIFIED', flush=True)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--check', action='store_true', help='Read-only package/live preflight; no staging or restart')
    mode.add_argument('--verify-https', action='store_true', help='Verify public TLS after DNS has been configured')
    args = parser.parse_args()
    if args.verify_https:
        verify_https()
    else:
        install(check_only=args.check)


if __name__ == '__main__':
    try:
        main()
    except Failure as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        print('WEBSITE_INSTALL_FAILED_REVIEW_PRIVATE_STATE', file=sys.stderr)
        sys.exit(1)
