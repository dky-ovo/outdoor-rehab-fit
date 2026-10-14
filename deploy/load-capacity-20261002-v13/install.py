#!/usr/bin/env python3
"""Install a verified v13 source/web delta on the exact v12 baseline. No DB migration."""
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
TAG = '20261002-v13'
PREFIX = 'outdoor-fit-load-capacity-' + TAG
IMAGE = 'outdoor-fit-api:' + TAG
BASE_ALIAS = 'outdoor-fit-load-capacity-base:' + TAG
BASELINE_IMAGE = 'outdoor-fit-api:20261002-v12'
BASELINE_ARCHIVE_SHA256 = '57b8272d6431be65816094484020658b1ac0bcd332e08e76ce2c5026d94e254a'
PROJECT = 'outdoor-fit-production'
STATE = BASE / '.update-state' / ('load-capacity-' + TAG)
RELEASE = BASE / 'releases' / PREFIX
PACKAGE = Path(__file__).resolve().parent
CONTAINERS = {service: PROJECT + '-' + service + '-1' for service in ('api', 'caddy')}
SOURCE_DELTA = {'server/src/' + name for name in ('appMysql.js', 'mysqlConfig.js', 'mysqlDatabase.js', 'lastSeenPolicy.js')}
SUPPORT_FILES = {'install.py', 'README.md', 'Dockerfile', 'Dockerfile.dockerignore'}
CONFIG_FILES = ('api.json', 'caddy.json', 'rollback-api.json', 'rollback-caddy.json')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(args, timeout=180):
    # Docker inspect/Compose may return secrets, and application errors may
    # contain SQL values. Retain their output in memory; never print it.
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('UPDATE_COMMAND_UNAVAILABLE') from None
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
    require(not path.is_symlink(), 'UPDATE_STATE_LINK_REFUSED')
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    path.chmod(0o600)
    return path


def save_compose(name, value):
    path = save(name, literal_compose(value))
    require(json.loads(run(compose(path, 'config', '--format', 'json'))) == value,
            'UPDATE_COMPOSE_ROUNDTRIP_MISMATCH')
    return path


def safe_name(name):
    require(isinstance(name, str) and '\\' not in name and ':' not in name, 'UPDATE_FILE_PATH_INVALID')
    path = PurePosixPath(name)
    require(name and not path.is_absolute() and '..' not in path.parts and path.as_posix() == name,
            'UPDATE_FILE_PATH_INVALID')
    require(not any(part.startswith('.') or part.lower() in {'secrets', 'credentials', '__pycache__'}
                    for part in path.parts), 'UPDATE_PRIVATE_PATH_REFUSED')
    require(path.suffix.lower() not in {'.pem', '.sqlite', '.db', '.key', '.pyc', '.map'}, 'UPDATE_PRIVATE_PATH_REFUSED')
    return path


def hash_records(value, prefix=None):
    require(isinstance(value, dict) and bool(value), 'UPDATE_MANIFEST_RECORDS_INVALID')
    for name, checksum in value.items():
        path = safe_name(name)
        require(isinstance(checksum, str) and re.fullmatch(r'[a-f0-9]{64}', checksum), 'UPDATE_MANIFEST_HASH_INVALID')
        if prefix:
            require(name.startswith(prefix) and len(path.parts) > len(PurePosixPath(prefix).parts), 'UPDATE_MANIFEST_PATH_INVALID')
    return value


def inventory(root, prefix):
    require(root.is_dir() and not root.is_symlink(), 'UPDATE_TREE_INVALID')
    records = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'UPDATE_TREE_LINK_REFUSED')
        if path.is_dir():
            continue
        require(path.is_file() and root.resolve() in path.resolve().parents, 'UPDATE_TREE_FILE_INVALID')
        name = prefix + path.relative_to(root).as_posix()
        safe_name(name)
        records[name] = digest(path.read_bytes())
    return records


def verify_package():
    manifest_path = PACKAGE / 'manifest.json'
    require(manifest_path.is_file() and not manifest_path.is_symlink(), 'UPDATE_MANIFEST_REQUIRED')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    require(manifest.get('release') == PREFIX and manifest.get('baselineImage') == BASELINE_IMAGE
            and manifest.get('baselineArchiveSha256') == BASELINE_ARCHIVE_SHA256, 'UPDATE_MANIFEST_RELEASE_INVALID')
    files = hash_records(manifest.get('files'))
    baseline_sources = hash_records(manifest.get('baselineSourceFiles'), 'server/src/')
    baseline_web = hash_records(manifest.get('baselineWebFiles'), 'web/')
    target_web = hash_records(manifest.get('webFiles'), 'web/')
    require(SOURCE_DELTA - {'server/src/lastSeenPolicy.js'} <= set(baseline_sources)
            and 'server/src/lastSeenPolicy.js' not in baseline_sources, 'UPDATE_SOURCE_BASELINE_INVALID')
    require({name for name in files if not name.startswith('web/')} == SOURCE_DELTA | SUPPORT_FILES,
            'UPDATE_PAYLOAD_FILESET_INVALID')
    require('web/index.html' in baseline_web and 'web/index.html' in target_web, 'UPDATE_WEB_INDEX_REQUIRED')
    for name, checksum in files.items():
        if name.startswith('web/'):
            require(target_web.get(name) == checksum, 'UPDATE_WEB_PAYLOAD_HASH_INVALID')
    for name, checksum in target_web.items():
        require(files.get(name) == checksum or (name not in files and baseline_web.get(name) == checksum),
                'UPDATE_REUSED_WEB_BASELINE_INVALID')
    actual = inventory(PACKAGE, '')
    require(set(actual) == set(files) | {'manifest.json'}, 'UPDATE_PACKAGE_FILESET_MISMATCH')
    require(all(actual[name] == checksum for name, checksum in files.items()), 'UPDATE_HASH_MISMATCH')
    return manifest


def capture(container, service):
    labels = container['Config']['Labels']
    require(labels.get('com.docker.compose.project') == PROJECT
            and labels.get('com.docker.compose.service') == service, 'UPDATE_PROJECT_MISMATCH')
    paths = labels.get('com.docker.compose.project.config_files', '').split(',')
    require(bool(paths) and all(paths), 'UPDATE_COMPOSE_LABEL_REQUIRED')
    command = ['docker', 'compose', '--project-name', PROJECT, '--env-file', str(BASE / 'secrets/production.env')]
    for name in paths:
        original = Path(name)
        path = original.resolve()
        require(not original.is_symlink() and BASE in path.parents and path.is_file(), 'UPDATE_COMPOSE_PATH_INVALID')
        command += ['-f', str(path)]
    value = json.loads(run(command + ['config', '--format', 'json']))
    require(set(value.get('services', {})) == {'api', 'caddy'}, 'UPDATE_COMPOSE_SERVICES_REQUIRE_REVIEW')
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


def verify_live_source(expected):
    names = {name.removeprefix('server/src/'): checksum for name, checksum in expected.items()}
    # Print only hashes/names of public runtime source. No process environment,
    # secrets directory, SQL, application data, or source text is printed.
    script = """const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root='/app/src', result={};
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
const name=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('SOURCE_LINK');
if(entry.isDirectory())walk(name);else if(entry.isFile())result[path.relative(root,name).split(path.sep).join('/')]=crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');else throw Error('SOURCE_SPECIAL');}}
walk(root);console.log(JSON.stringify(result));"""
    require(json.loads(run(['docker', 'exec', CONTAINERS['api'], 'node', '-e', script])) == names,
            'UPDATE_LIVE_SOURCE_BASELINE_MISMATCH')


def preflight(manifest):
    require(not STATE.exists() and not STATE.is_symlink() and not RELEASE.exists() and not RELEASE.is_symlink(),
            'UPDATE_ALREADY_STAGED_REVIEW_STATE')
    for path in (BASE / '.update-state', BASE / 'releases'):
        require(not path.is_symlink() and (not path.exists() or path.is_dir()), 'UPDATE_PARENT_PATH_INVALID')
    api, caddy = inspect(CONTAINERS['api']), inspect(CONTAINERS['caddy'])
    require(api['State']['Running'] and caddy['State']['Running'], 'UPDATE_SERVICES_NOT_RUNNING')
    require(api['Config']['Image'] == BASELINE_IMAGE, 'UPDATE_EXACT_V12_BASELINE_REQUIRED')
    api_config, caddy_config = capture(api, 'api'), capture(caddy, 'caddy')
    environment = dict(item.split('=', 1) for item in api['Config'].get('Env', []) if '=' in item)
    require(environment.get('MYSQL_POOL_SIZE', '4') == '4', 'UPDATE_POOL_SIZE_REQUIRES_REVIEW')
    verify_live_source(manifest['baselineSourceFiles'])
    web_mounts = [item for item in caddy['Mounts'] if item['Destination'] == '/srv/admin']
    require(len(web_mounts) == 1 and web_mounts[0]['Type'] == 'bind' and not web_mounts[0]['RW'],
            'UPDATE_READONLY_WEB_MOUNT_REQUIRED')
    current_web = Path(web_mounts[0]['Source'])
    require(BASE in current_web.resolve().parents, 'UPDATE_WEB_PATH_INVALID')
    require(inventory(current_web, 'web/') == manifest['baselineWebFiles'], 'UPDATE_LIVE_WEB_BASELINE_MISMATCH')
    for reference in (IMAGE, BASE_ALIAS):
        require(not run(['docker', 'image', 'ls', '--quiet', '--no-trunc', reference]).strip(), 'UPDATE_TARGET_IMAGE_ALREADY_EXISTS')
    return api, caddy, api_config, caddy_config, current_web


def configure_capacity(config, queue_limit):
    require(isinstance(queue_limit, int) and not isinstance(queue_limit, bool) and 1 <= queue_limit <= 256,
            'UPDATE_QUEUE_LIMIT_INVALID')
    result = copy.deepcopy(config)
    env = result['services']['api'].setdefault('environment', {})
    env['MYSQL_POOL_SIZE'] = '4'
    env['MYSQL_POOL_QUEUE_LIMIT'] = str(queue_limit)
    result['services']['api']['image'] = IMAGE
    return result


def runtime_signature(container):
    config, host = container['Config'], container.get('HostConfig', {})
    value = {'environment': sorted(config.get('Env', [])),
             'config': {key: config.get(key) for key in ('Cmd', 'Entrypoint', 'User', 'WorkingDir', 'ExposedPorts')},
             'labels': {key: value for key, value in config.get('Labels', {}).items() if not key.startswith('com.docker.compose.')},
             'mounts': sorted(({key: item.get(key) for key in ('Type', 'Source', 'Destination', 'RW')}
                              for item in container.get('Mounts', [])), key=lambda item: item['Destination']),
             'host': {key: host.get(key) for key in ('NanoCpus', 'Memory', 'MemorySwap', 'PidsLimit', 'ReadonlyRootfs',
                       'Privileged', 'NetworkMode', 'CapAdd', 'CapDrop', 'SecurityOpt', 'RestartPolicy', 'PortBindings', 'Tmpfs')}}
    return digest(json.dumps(value, sort_keys=True).encode())


def predicted_container(container, service, queue_limit=None):
    value = copy.deepcopy(container)
    if service == 'api':
        env = dict(item.split('=', 1) for item in value['Config'].get('Env', []) if '=' in item)
        env.update(MYSQL_POOL_SIZE='4', MYSQL_POOL_QUEUE_LIMIT=str(queue_limit))
        value['Config']['Env'] = [key + '=' + item for key, item in env.items()]
    else:
        for mount in value['Mounts']:
            if mount['Destination'] == '/srv/admin':
                mount['Source'] = str(RELEASE / 'web')
    return value


def observe_recovery():
    result = {}
    for service, name in CONTAINERS.items():
        present = run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
        require(not present or re.fullmatch(r'[a-f0-9]{12,64}', present), 'UPDATE_DOCKER_CONTAINER_QUERY_INVALID')
        result[service] = inspect(name) if present else None
    return result


def recovery_guard(recovery, observed):
    require(recovery.get('release') == PREFIX, 'UPDATE_RECOVERY_RELEASE_INVALID')
    for name, checksum in recovery['configHashes'].items():
        require(name in CONFIG_FILES and not (STATE / name).is_symlink()
                and digest((STATE / name).read_bytes()) == checksum, 'UPDATE_RECOVERY_CONFIG_CHANGED')
    require(set(recovery['configHashes']) == set(CONFIG_FILES), 'UPDATE_RECOVERY_CONFIG_INVALID')
    for service, container in observed.items():
        if container is None:
            continue
        labels = container['Config']['Labels']
        require(labels.get('com.docker.compose.project') == PROJECT
                and labels.get('com.docker.compose.service') == service, 'UPDATE_RECOVERY_PROJECT_MISMATCH')
        found = {'configFiles': labels.get('com.docker.compose.project.config_files'),
                 'imageId': container['Image'], 'signature': runtime_signature(container)}
        require(found in recovery['services'][service], 'UPDATE_LATER_DEPLOYMENT_PRESENT')
    for image in recovery['rollbackImages'].values():
        require(image_id(image) == image, 'UPDATE_ROLLBACK_IMAGE_UNAVAILABLE')
    require(inventory(Path(recovery['baselineWebRoot']), 'web/') == recovery['baselineWebFiles'],
            'UPDATE_ROLLBACK_WEB_BASELINE_CHANGED')


def up(path, service):
    run(compose(path, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service))


def health():
    script = "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(r=>process.exit(r.ok&&r.service==='outdoor-fit-api'?0:1)).catch(()=>process.exit(1))"
    for attempt in range(24):
        try:
            run(['docker', 'exec', CONTAINERS['api'], 'node', '-e', script], timeout=10)
            return
        except RuntimeError:
            if attempt < 23:
                time.sleep(2)
    raise RuntimeError('UPDATE_HEALTH_FAILED')


def verify_public_web():
    curl = ['curl', '--fail', '--silent', '--show-error', '--retry', '5', '--retry-all-errors', '--max-time', '15']
    response = run(curl + ['https://api.outdoorfit.hk/api/health'])
    require(json.loads(response).get('ok') is True, 'UPDATE_PUBLIC_API_UNHEALTHY')
    expected = (RELEASE / 'web/index.html').read_bytes()
    for url in ('https://app.outdoorfit.hk/', 'https://admin.outdoorfit.hk/admin'):
        response = run(curl + [url])
        require(response.encode() == expected, 'UPDATE_WEB_RESPONSE_MISMATCH')


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
    require(not failures, 'UPDATE_ROLLBACK_INCOMPLETE_REVIEW_STATE')


def guarded_rollback(recovery, services):
    recovery_guard(recovery, observe_recovery())
    rollback_services(services)


def install(queue_limit=128, check_only=False):
    manifest = verify_package()
    api, caddy, api_config, caddy_config, current_web = preflight(manifest)
    if check_only:
        print('LOAD_CAPACITY_PREFLIGHT=PASS', flush=True)
        return
    STATE.mkdir(mode=0o700, parents=True)
    RELEASE.mkdir(mode=0o755, parents=True)
    save('report.json', {'status': 'staging', 'baseline': BASELINE_IMAGE, 'release': PREFIX})
    for name in manifest['files']:
        source, target = PACKAGE / name, RELEASE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        target.chmod(0o644)
    for name in manifest['webFiles']:
        if name not in manifest['files']:
            relative = safe_name(name)
            source, target = current_web.joinpath(*relative.parts[1:]), RELEASE / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            target.chmod(0o644)
    require(all(digest((RELEASE / name).read_bytes()) == checksum for name, checksum in manifest['files'].items()),
            'UPDATE_PAYLOAD_COPY_MISMATCH')
    require(inventory(RELEASE / 'web', 'web/') == manifest['webFiles'], 'UPDATE_WEB_COPY_MISMATCH')
    for directory, _, _ in os.walk(RELEASE):
        Path(directory).chmod(0o755)
    print('UPDATE_PHASE=building', flush=True)
    # A raw sha256 config ID in FROM may be parsed as a registry tag by
    # BuildKit. Tag the verified local image without pulling, then verify the
    # unique alias still identifies the captured baseline before the build.
    run(['docker', 'tag', api['Image'], BASE_ALIAS])
    require(image_id(BASE_ALIAS) == api['Image'], 'UPDATE_BASE_ALIAS_MISMATCH')
    run(['docker', 'build', '--pull=false', '--build-arg', 'BASE_IMAGE=' + BASE_ALIAS, '-t', IMAGE, str(RELEASE)], timeout=600)
    new_image = image_id(IMAGE)
    new_api = configure_capacity(api_config, queue_limit)
    old_api = copy.deepcopy(api_config)
    old_api['services']['api']['image'] = api['Image']
    new_caddy = copy.deepcopy(caddy_config)
    old_caddy = copy.deepcopy(caddy_config)
    new_caddy['services']['caddy']['image'] = caddy['Image']
    old_caddy['services']['caddy']['image'] = caddy['Image']
    volumes = new_caddy['services']['caddy']['volumes']
    require(sum(item['target'] == '/srv/admin' for item in volumes) == 1, 'UPDATE_WEB_MOUNT_REQUIRED')
    for item in volumes:
        if item['target'] == '/srv/admin':
            item['source'] = str(RELEASE / 'web')
    for name, value in [('api.json', new_api), ('rollback-api.json', old_api),
                        ('caddy.json', new_caddy), ('rollback-caddy.json', old_caddy)]:
        save_compose(name, value)
    recovery = {'release': PREFIX, 'services': {},
                'configHashes': {name: digest((STATE / name).read_bytes()) for name in CONFIG_FILES},
                'rollbackImages': {'api': api['Image'], 'caddy': caddy['Image']},
                'baselineWebRoot': str(current_web), 'baselineWebFiles': manifest['baselineWebFiles']}
    for service, container in [('api', api), ('caddy', caddy)]:
        baseline = {'configFiles': container['Config']['Labels']['com.docker.compose.project.config_files'],
                    'imageId': container['Image'], 'signature': runtime_signature(container)}
        restored = {**baseline, 'configFiles': str(STATE / ('rollback-' + service + '.json'))}
        updated = {'configFiles': str(STATE / (service + '.json')), 'imageId': new_image if service == 'api' else container['Image'],
                   'signature': runtime_signature(predicted_container(container, service, queue_limit))}
        recovery['services'][service] = [baseline, updated, restored]
    save('recovery.json', recovery)
    script = STATE / 'rollback.sh'
    script.write_text('#!/bin/bash\nset -euo pipefail\numask 077\nexec ' + shlex.join(['python3', str(RELEASE / 'install.py'), '--rollback']) + '\n')
    script.chmod(0o700)
    print('ROLLBACK_SCRIPT=' + str(script), flush=True)
    require(inspect(CONTAINERS['api'])['Id'] == api['Id'] and inspect(CONTAINERS['caddy'])['Id'] == caddy['Id'],
            'UPDATE_LIVE_STATE_CHANGED')
    recovery_guard(recovery, observe_recovery())
    changed = []
    try:
        print('UPDATE_PHASE=activating', flush=True)
        changed.append('api')
        up(STATE / 'api.json', 'api')
        health()
        recovery_guard(recovery, observe_recovery())
        changed.append('caddy')
        up(STATE / 'caddy.json', 'caddy')
        require(inspect(CONTAINERS['caddy'])['State']['Running'], 'UPDATE_CADDY_START_FAILED')
        recovery_guard(recovery, observe_recovery())
        verify_public_web()
        save('report.json', {'status': 'complete', 'image': IMAGE, 'baseline': BASELINE_IMAGE,
                             'poolSize': 4, 'queueLimit': queue_limit, 'web': str(RELEASE / 'web')})
        print('LOAD_CAPACITY_UPDATE=PASS', flush=True)
    except BaseException:
        print('UPDATE_PHASE=rollback', flush=True)
        guarded_rollback(recovery, changed)
        save('report.json', {'status': 'activation_failed_rolled_back', 'release': PREFIX})
        raise


def bounded_queue(value):
    if not re.fullmatch(r'[0-9]{1,3}', value or '') or not 1 <= int(value) <= 256:
        raise argparse.ArgumentTypeError('Queue limit must be an integer from 1 to 256')
    return int(value)


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0 and BASE.is_dir() and not BASE.is_symlink(), 'UPDATE_ROOT_AND_PRODUCTION_BASE_REQUIRED')
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--rollback', action='store_true')
    actions.add_argument('--check-only', action='store_true', help='Verify exact baseline without staging or activation')
    parser.add_argument('--queue-limit', type=bounded_queue, default=128)
    args = parser.parse_args()
    require(not (BASE / '.account-data.lock').is_symlink(), 'UPDATE_LOCK_LINK_REFUSED')
    with (BASE / '.account-data.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            require(STATE.is_dir() and not STATE.is_symlink(), 'UPDATE_ROLLBACK_STATE_REQUIRED')
            recovery = json.loads((STATE / 'recovery.json').read_text(encoding='utf-8'))
            guarded_rollback(recovery, ['api', 'caddy'])
            save('report.json', {'status': 'rolled_back', 'release': PREFIX})
            print('LOAD_CAPACITY_ROLLBACK=PASS', flush=True)
        else:
            install(queue_limit=args.queue_limit, check_only=args.check_only)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only internal fixed error codes are safe to print; filesystem,
        # JSON, subprocess and Compose exceptions can contain private values.
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'UPDATE_[A-Z0-9_]{1,80}', str(error)) else 'UPDATE_FAILED_REVIEW_STATE'
        print(code, file=sys.stderr)
        sys.exit(1)
