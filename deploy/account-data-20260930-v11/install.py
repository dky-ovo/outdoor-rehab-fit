#!/usr/bin/env python3
"""Install the v11 successor from v9/v10. Never publish a mobile OTA."""
import argparse
import copy
import getpass
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
TAG = '20260930-v11'
PREFIX = 'outdoor-fit-account-data-' + TAG
IMAGE = 'outdoor-fit-api:' + TAG
PROJECT = 'outdoor-fit-production'
STATE = BASE / '.update-state' / ('account-data-' + TAG)
RELEASE = BASE / 'releases' / PREFIX
PACKAGE = Path(__file__).resolve().parent
BASELINES = {'outdoor-fit-api:20260928-v9', 'outdoor-fit-api:20260928-v10'}
CONTAINERS = {service: PROJECT + '-' + service + '-1' for service in ('api', 'caddy')}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def run(args, data=None, timeout=180):
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        for line in (result.stdout + result.stderr).splitlines():
            if re.fullmatch(r'(ACCOUNT_DATA_SCHEMA=(PASS|FAIL)|ERROR_CODE=[A-Z0-9_]{1,80})', line):
                print(line, flush=True)
    require(result.returncode == 0, 'UPDATE_COMMAND_FAILED')
    return result.stdout


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def image_id(name):
    return json.loads(run(['docker', 'image', 'inspect', name]))[0]['Id']


def compose(path, *args):
    return ['docker', 'compose', '--project-name', PROJECT, '-f', str(path), *args]


def literal_compose(value):
    if isinstance(value, str):
        return value.replace('$', '$$')
    if isinstance(value, list):
        return [literal_compose(item) for item in value]
    if isinstance(value, dict):
        return {key: literal_compose(item) for key, item in value.items()}
    return value


def save(name, value):
    path = STATE / name
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)
    return path


def save_compose(name, value):
    path = save(name, literal_compose(value))
    resolved = json.loads(run(compose(path, 'config', '--format', 'json')))
    require(resolved == value, 'UPDATE_COMPOSE_ROUNDTRIP_MISMATCH')
    return path


def capture(container, service):
    labels = container['Config']['Labels']
    require(labels.get('com.docker.compose.project') == PROJECT
            and labels.get('com.docker.compose.service') == service, 'UPDATE_PROJECT_MISMATCH')
    command = ['docker', 'compose', '--env-file', str(BASE / 'secrets/production.env')]
    for name in labels['com.docker.compose.project.config_files'].split(','):
        path = Path(name).resolve()
        require(BASE in path.parents and path.is_file(), 'UPDATE_COMPOSE_PATH_INVALID')
        command += ['-f', str(path)]
    value = json.loads(run(command + ['config', '--format', 'json']))
    resolved = value['services'][service]
    require(image_id(resolved['image']) == container['Image'], 'UPDATE_LIVE_IMAGE_CONFIG_DRIFT')
    environment = dict(item.split('=', 1) for item in container['Config'].get('Env', []) if '=' in item)
    for key, expected in resolved.get('environment', {}).items():
        require(environment.get(key) == str(expected), 'UPDATE_LIVE_ENVIRONMENT_CONFIG_DRIFT')
    mounts = {item['Destination']: item for item in container['Mounts']}
    for volume in resolved.get('volumes', []):
        if volume['type'] == 'bind':
            mounted = mounts.get(volume['target'], {})
            require(mounted.get('Type') == 'bind' and mounted.get('Source') == volume['source']
                    and mounted.get('RW') == (not volume.get('read_only', False)), 'UPDATE_LIVE_MOUNT_CONFIG_DRIFT')
    return value


def up(path, service):
    run(compose(path, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service))


def health():
    for attempt in range(24):
        result = subprocess.run(['docker', 'exec', CONTAINERS['api'], 'node', '-e',
            "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(r=>process.exit(r.ok&&r.service==='outdoor-fit-api'?0:1)).catch(()=>process.exit(1))"],
            capture_output=True, timeout=10)
        if result.returncode == 0:
            return
        if attempt < 23:
            time.sleep(2)
    raise RuntimeError('UPDATE_HEALTH_FAILED')


def recovery_guard(recovery, observed):
    """Refuse an older recovery snapshot after either service has been redeployed."""
    for service, container in observed.items():
        if container is None:
            continue
        labels = container['Config']['Labels']
        expected = recovery[service]
        require(labels.get('com.docker.compose.project') == PROJECT
                and labels.get('com.docker.compose.service') == service
                and labels.get('com.docker.compose.project.config_files') in expected['configFiles']
                and container['Image'] in expected['imageIds'], 'UPDATE_LATER_DEPLOYMENT_PRESENT')


def observe_recovery():
    result = {}
    for service, name in CONTAINERS.items():
        # Distinguish an absent container from a stopped/unavailable Docker daemon.
        present = run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
        result[service] = inspect(name) if present else None
    return result


def rollback_services(services):
    failures = []
    for service in services:
        try:
            up(STATE / ('rollback-' + service + '.json'), service)
            if service == 'api':
                health()
            else:
                require(inspect(CONTAINERS['caddy'])['State']['Running'], 'UPDATE_CADDY_ROLLBACK_FAILED')
        except BaseException:
            failures.append(service)
    if failures:
        print('UPDATE_ROLLBACK_FAILED_SERVICES=' + ','.join(failures), flush=True)
        raise RuntimeError('UPDATE_ROLLBACK_INCOMPLETE_REVIEW_STATE')


def guarded_rollback(recovery, services):
    recovery_guard(recovery, observe_recovery())
    rollback_services(services)


def safe_package_name(name):
    require(isinstance(name, str) and '\\' not in name and ':' not in name, 'UPDATE_FILE_PATH_INVALID')
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts and path.as_posix() == name,
            'UPDATE_FILE_PATH_INVALID')
    return path


def rollback_image(api, base_image):
    if api['Config']['Image'].endswith(':20260928-v10'):
        # Pin the running v10 image by ID so a later mutable tag cannot change recovery.
        return api['Image']
    rollback = STATE / 'rollback'
    rollback.mkdir()
    run(['docker', 'cp', CONTAINERS['api'] + ':/app/src/production.js', str(rollback / 'production.js')])
    source = (rollback / 'production.js').read_text()
    require(source.count('Number(tables?.count) !== 40') == 1, 'UPDATE_BASELINE_REQUIRES_REVIEW')
    (rollback / 'production.js').write_text(source.replace('Number(tables?.count) !== 40', '![40, 41].includes(Number(tables?.count))'))
    (rollback / 'Dockerfile').write_text('FROM ' + base_image + '\nCOPY --chown=1000:1000 production.js /app/src/production.js\nRUN node --check /app/src/production.js\n')
    image = 'outdoor-fit-account-data-rollback:' + TAG
    run(['docker', 'build', '--pull=false', '-t', image, str(rollback)], timeout=600)
    return image_id(image)


def install():
    manifest = json.loads((PACKAGE / 'manifest.json').read_text(encoding='utf-8'))
    require(manifest.get('release') == PREFIX and set(manifest.get('baselines', [])) == BASELINES,
            'UPDATE_MANIFEST_RELEASE_INVALID')
    for name, expected in manifest['files'].items():
        safe_package_name(name)
        path = PACKAGE / name
        require(not path.is_symlink() and path.is_file() and PACKAGE in path.resolve().parents, 'UPDATE_FILE_INVALID')
        require(hashlib.sha256(path.read_bytes()).hexdigest() == expected, 'UPDATE_HASH_MISMATCH')
    require(not STATE.exists() and not RELEASE.exists(), 'UPDATE_ALREADY_STAGED_REVIEW_STATE')
    api, caddy = inspect(CONTAINERS['api']), inspect(CONTAINERS['caddy'])
    require(api['State']['Running'] and caddy['State']['Running'], 'UPDATE_SERVICES_NOT_RUNNING')
    require(api['Config']['Image'] in BASELINES, 'UPDATE_V9_OR_V10_BASELINE_REQUIRED')
    api_config, caddy_config = capture(api, 'api'), capture(caddy, 'caddy')
    web_mounts = [item for item in caddy['Mounts'] if item['Destination'] == '/srv/admin']
    require(len(web_mounts) == 1 and web_mounts[0]['Type'] == 'bind', 'UPDATE_WEB_MOUNT_REQUIRED')
    current_web = Path(web_mounts[0]['Source'])
    reused_web = {}
    for name, expected in manifest['webFiles'].items():
        relative = safe_package_name(name)
        require(len(relative.parts) > 1 and relative.parts[0] == 'web', 'UPDATE_WEB_PATH_INVALID')
        if name in manifest['files']:
            continue
        source = current_web.joinpath(*relative.parts[1:])
        require(not source.is_symlink() and source.is_file() and current_web.resolve() in source.resolve().parents,
                'UPDATE_BASE_WEB_MISSING')
        require(hashlib.sha256(source.read_bytes()).hexdigest() == expected, 'UPDATE_BASE_WEB_HASH_MISMATCH')
        reused_web[name] = source
    STATE.mkdir(mode=0o700, parents=True)
    RELEASE.mkdir(mode=0o755, parents=True)
    for name in manifest['files']:
        source, target = PACKAGE / name, RELEASE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o644)
    for name, source in reused_web.items():
        target = RELEASE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o644)
    for name, expected in manifest['webFiles'].items():
        require(hashlib.sha256((RELEASE / name).read_bytes()).hexdigest() == expected, 'UPDATE_WEB_COPY_MISMATCH')
    for directory, _, _ in os.walk(RELEASE):
        Path(directory).chmod(0o755)
    base_image = 'outdoor-fit-account-data-base:' + TAG
    run(['docker', 'tag', api['Image'], base_image])
    print('UPDATE_PHASE=building', flush=True)
    run(['docker', 'build', '--pull=false', '--build-arg', 'BASE_IMAGE=' + base_image, '-t', IMAGE, str(RELEASE)], timeout=600)
    fallback_image = rollback_image(api, base_image)
    new_api = copy.deepcopy(api_config)
    new_api['services']['api']['image'] = IMAGE
    old_api = copy.deepcopy(api_config)
    old_api['services']['api']['image'] = fallback_image
    new_web = copy.deepcopy(caddy_config)
    volumes = new_web['services']['caddy']['volumes']
    require(sum(item['target'] == '/srv/admin' for item in volumes) == 1, 'UPDATE_WEB_MOUNT_REQUIRED')
    for item in volumes:
        if item['target'] == '/srv/admin':
            item['source'] = str(RELEASE / 'web')
    for name, value in [('api.json', new_api), ('rollback-api.json', old_api), ('caddy.json', new_web), ('rollback-caddy.json', caddy_config)]:
        save_compose(name, value)
    recovery = {}
    for service, container in [('api', api), ('caddy', caddy)]:
        recovery[service] = {
            'configFiles': [container['Config']['Labels']['com.docker.compose.project.config_files'],
                            str(STATE / (service + '.json')), str(STATE / ('rollback-' + service + '.json'))],
            'imageIds': list({container['Image'], image_id(IMAGE), fallback_image} if service == 'api' else {container['Image']}),
        }
    save('recovery.json', recovery)
    script = STATE / 'rollback.sh'
    script.write_text('#!/bin/bash\nset -euo pipefail\numask 077\nexec ' + shlex.join(['python3', str(RELEASE / 'install.py'), '--rollback']) + '\n')
    script.chmod(0o700)
    print('ROLLBACK_SCRIPT=' + str(script), flush=True)
    require(inspect(CONTAINERS['api'])['Id'] == api['Id'] and inspect(CONTAINERS['caddy'])['Id'] == caddy['Id'],
            'UPDATE_LIVE_STATE_CHANGED')
    print('UPDATE_PHASE=schema', flush=True)
    environment = dict(item.split('=', 1) for item in api['Config']['Env'] if '=' in item)
    command = ['docker', 'run', '--rm', '-i', '--network', 'container:' + CONTAINERS['api'], '--volumes-from', CONTAINERS['api'] + ':ro']
    for key in ('MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_DATABASE', 'MYSQL_SSL_CA'):
        require(environment.get(key), 'UPDATE_MYSQL_CONFIGURATION_MISSING')
        command += ['-e', key + '=' + environment[key]]
    command += ['--entrypoint', 'node', IMAGE, 'continuity/migrate.mjs']
    password = getpass.getpass('RDS password for outdoor_fit_migrator: ')
    try:
        print(run(command, data=json.dumps({'password': password})), end='', flush=True)
    except BaseException:
        guarded_rollback(recovery, ['api'])
        raise
    finally:
        password = None
    changed = []
    try:
        print('UPDATE_PHASE=activating', flush=True)
        changed.append('api')
        up(STATE / 'api.json', 'api')
        health()
        changed.append('caddy')
        up(STATE / 'caddy.json', 'caddy')
        response = run(['curl', '--fail', '--silent', '--show-error', '--retry', '5', '--retry-all-errors', '--max-time', '15', 'https://api.outdoorfit.hk/api/health'])
        require(json.loads(response).get('ok') is True, 'UPDATE_PUBLIC_API_UNHEALTHY')
        expected = (RELEASE / 'web/index.html').read_bytes()
        for url in ['https://admin.outdoorfit.hk/admin', 'https://app.outdoorfit.hk/']:
            html = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', url])
            require(html.encode() == expected, 'UPDATE_WEB_RESPONSE_MISMATCH')
        for endpoint in ['account/data/sync', 'account/learning']:
            args = ['curl', '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}', '--max-time', '15']
            if endpoint.endswith('sync'):
                args += ['--request', 'POST', '--header', 'Content-Type: application/json', '--data', '{}']
            require(run(args + ['https://api.outdoorfit.hk/api/' + endpoint]).strip() == '401', 'UPDATE_ACCOUNT_ROUTE_MISSING')
        save('report.json', {'status': 'complete', 'image': IMAGE, 'baseline': api['Config']['Image'], 'web': str(RELEASE / 'web')})
        print('ACCOUNT_DATA_UPDATE=PASS', flush=True)
    except BaseException:
        print('UPDATE_PHASE=rollback', flush=True)
        guarded_rollback(recovery, changed)
        raise


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0 and BASE.is_dir() and not BASE.is_symlink(), 'UPDATE_ROOT_AND_PRODUCTION_BASE_REQUIRED')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rollback', action='store_true')
    args = parser.parse_args()
    with (BASE / '.account-data.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            recovery = json.loads((STATE / 'recovery.json').read_text(encoding='utf-8'))
            guarded_rollback(recovery, ['api', 'caddy'])
            print('ACCOUNT_DATA_ROLLBACK=PASS', flush=True)
        else:
            install()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'ACCOUNT_DATA_UPDATE_FAILED_REVIEW_STATE', file=sys.stderr)
        sys.exit(1)
