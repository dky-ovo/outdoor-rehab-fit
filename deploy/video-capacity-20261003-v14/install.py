#!/usr/bin/env python3
"""Install public-video derivatives and a web delta on verified v13. No DB writes."""
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
TAG = '20261003-v14'
PREFIX = 'outdoor-fit-video-capacity-' + TAG
IMAGE = 'outdoor-fit-api:' + TAG
BASE_ALIAS = 'outdoor-fit-video-capacity-base:' + TAG
BASELINE_IMAGE = 'outdoor-fit-api:20261002-v13'
BASELINE_ARCHIVE_SHA256 = '66ce313262affcb8fbe375b138fd47d8cb8d4337a3c69e2924464544098a987f'
PROJECT = 'outdoor-fit-production'
STATE = BASE / '.update-state' / ('video-capacity-' + TAG)
RELEASE = BASE / 'releases' / PREFIX
PACKAGE = Path(__file__).resolve().parent
CONTAINERS = {service: PROJECT + '-' + service + '-1' for service in ('api', 'caddy')}
SOURCE_DELTA = {'server/src/' + name for name in ('app.js', 'appMysql.js', 'production.js', 'mediaLibrary.js',
                                                  'mysqlMediaLibrary.js', 'publicVideoDelivery.js')}
SUPPORT_FILES = {'install.py', 'README.md', 'Dockerfile', 'Dockerfile.dockerignore'}
CONFIG_FILES = ('api.json', 'caddy.json', 'rollback-api.json', 'rollback-caddy.json')
DELIVERY_ROOT = '/app/data/video-delivery'


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


def validate_caddy(text):
    # Parse/provision in the existing container; no reload and no server starts.
    try:
        result = subprocess.run(['docker', 'exec', '-i', CONTAINERS['caddy'], 'caddy', 'adapt',
                                 '--config', '-', '--adapter', 'caddyfile', '--validate'],
                                input=text, text=True, capture_output=True, timeout=45)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('UPDATE_CADDY_VALIDATION_UNAVAILABLE') from None
    require(result.returncode == 0, 'UPDATE_CADDY_VALIDATION_FAILED')


def patch_caddy(text):
    anchor = 'header Cache-Control "no-cache"'
    require(text.count(anchor) == 2 and text.count('root * /srv/admin') == 2
            and 'videoCapacityAssets' not in text, 'UPDATE_CADDY_CACHE_BASELINE_REQUIRES_REVIEW')
    # try_files already runs before this route. A missing hashed asset rewrites
    # to index.html and never receives the immutable header.
    replacement = '''route {
            header Cache-Control "no-cache"
            @videoCapacityAssets {
                path_regexp videoCapacityAssets ^/(?:_expo/static/(?:js|css)/|assets/).*[.-][a-f0-9]{32}\\.(?:js|css|ttf|otf|woff2?|png|jpe?g|webp|gif|svg)$
                file {path}
            }
            header @videoCapacityAssets Cache-Control "public, max-age=31536000, immutable"
        }'''
    return text.replace(anchor, replacement)


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


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def verify_media_payload(files):
    media = json.loads((PACKAGE / 'media/manifest.json').read_text(encoding='utf-8'))
    require(media.get('version') == 1 and media.get('complete') is True and isinstance(media.get('entries'), list)
            and 0 < len(media['entries']) <= 1000, 'UPDATE_MEDIA_MANIFEST_INVALID')
    sources, outputs = {}, set()
    for entry in media['entries']:
        source, output = entry.get('sourceSha256'), entry.get('derivativeSha256')
        require(isinstance(source, str) and re.fullmatch(r'[a-f0-9]{64}', source)
                and isinstance(output, str) and re.fullmatch(r'[a-f0-9]{64}', output)
                and source not in sources, 'UPDATE_MEDIA_HASH_OR_DUPLICATE_INVALID')
        require(entry.get('derivativeStorageName') == output + '.mp4', 'UPDATE_MEDIA_OUTPUT_NAME_INVALID')
        for key in ('sourceSizeBytes', 'derivativeSizeBytes'):
            require(type(entry.get(key)) is int and 0 < entry[key] <= 250 * 1024 * 1024, 'UPDATE_MEDIA_SIZE_INVALID')
        require(entry['derivativeSizeBytes'] < entry['sourceSizeBytes'], 'UPDATE_MEDIA_NOT_SMALLER')
        require(entry.get('fullDecodePassed') is True and entry.get('fastStart') is True and entry.get('visualReviewPassed') is True
                and entry.get('videoCodec') == 'h264' and entry.get('audioCodec') == 'aac', 'UPDATE_MEDIA_QA_REQUIRED')
        require(isinstance(entry.get('durationSeconds'), (int, float)) and entry['durationSeconds'] > 0
                and isinstance(entry.get('sourcePlaybackDurationSeconds'), (int, float)) and entry['sourcePlaybackDurationSeconds'] > 0
                and isinstance(entry.get('durationDifferenceSeconds'), (int, float)) and 0 <= entry['durationDifferenceSeconds'] <= 0.1
                and isinstance(entry.get('totalBitrateMbps'), (int, float)) and 0 < entry['totalBitrateMbps'] <= 1.5,
                'UPDATE_MEDIA_DURATION_OR_BITRATE_INVALID')
        if 'sourceStorageName' in entry:
            require(isinstance(entry['sourceStorageName'], str)
                    and re.fullmatch(r'[a-f0-9-]+\.(?:mp4|mov|webm)', entry['sourceStorageName']), 'UPDATE_MEDIA_SOURCE_NAME_INVALID')
        name = 'media/derivatives/' + output + '.mp4'
        derivative = PACKAGE / name
        require(files.get(name) == output and derivative.is_file() and not derivative.is_symlink()
                and derivative.stat().st_size == entry['derivativeSizeBytes']
                and file_digest(derivative) == output, 'UPDATE_MEDIA_DERIVATIVE_MISMATCH')
        sources[source] = entry['sourceSizeBytes']
        outputs.add(name)
    require({name for name in files if name.startswith('media/')} == outputs | {'media/manifest.json'},
            'UPDATE_MEDIA_FILESET_MISMATCH')
    return sources


def verify_media_sources(storage_root):
    # Read public-seed candidates only, without querying or changing business DB.
    # Actual public/deleted/archive status remains checked by API per request.
    manifest = json.loads((PACKAGE / 'manifest.json').read_text(encoding='utf-8'))
    expected = verify_media_payload(manifest['files'])
    media_manifest = json.loads((PACKAGE / 'media/manifest.json').read_text(encoding='utf-8'))
    bound = {entry['sourceSha256']: entry.get('sourceStorageName') for entry in media_manifest['entries']}
    sizes = set(expected.values())
    matches = set()
    for source in storage_root.iterdir():
        if source.is_symlink() or not source.is_file() or source.suffix.lower() not in {'.mp4', '.mov', '.webm'}:
            continue
        if source.stat().st_size not in sizes:
            continue
        checksum = file_digest(source)
        if (checksum in expected and source.stat().st_size == expected[checksum]
                and (not bound[checksum] or source.name == bound[checksum])):
            matches.add(checksum)
    return {'manifestSources': len(expected), 'matchedSources': len(matches),
            'unmatchedSources': len(expected) - len(matches), 'unknownSourcesKeepOriginal': True}


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
    require(SOURCE_DELTA - {'server/src/publicVideoDelivery.js'} <= set(baseline_sources)
            and 'server/src/lastSeenPolicy.js' in baseline_sources
            and 'server/src/publicVideoDelivery.js' not in baseline_sources, 'UPDATE_SOURCE_BASELINE_INVALID')
    require({name for name in files if not name.startswith(('web/', 'media/'))} == SOURCE_DELTA | SUPPORT_FILES,
            'UPDATE_PAYLOAD_FILESET_INVALID')
    require(files.get('media/manifest.json') == manifest.get('mediaManifestSha256'), 'UPDATE_MEDIA_MANIFEST_HASH_INVALID')
    require(all(name == 'media/manifest.json' or re.fullmatch(r'media/derivatives/[a-zA-Z0-9_-]+\.mp4', name)
                for name in files if name.startswith('media/')), 'UPDATE_MEDIA_PAYLOAD_PATH_INVALID')
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
    verify_media_payload(files)
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
    require(api['Config']['Image'] == BASELINE_IMAGE, 'UPDATE_EXACT_V13_BASELINE_REQUIRED')
    api_config, caddy_config = capture(api, 'api'), capture(caddy, 'caddy')
    environment = dict(item.split('=', 1) for item in api['Config'].get('Env', []) if '=' in item)
    require(environment.get('MYSQL_POOL_SIZE', '4') == '4', 'UPDATE_POOL_SIZE_REQUIRES_REVIEW')
    require(not environment.get('MEDIA_VIDEO_CDN_ORIGIN', ''), 'UPDATE_EXISTING_CDN_REQUIRES_REVIEW')
    verify_live_source(manifest['baselineSourceFiles'])
    web_mounts = [item for item in caddy['Mounts'] if item['Destination'] == '/srv/admin']
    require(len(web_mounts) == 1 and web_mounts[0]['Type'] == 'bind' and not web_mounts[0]['RW'],
            'UPDATE_READONLY_WEB_MOUNT_REQUIRED')
    current_web = Path(web_mounts[0]['Source'])
    require(BASE in current_web.resolve().parents, 'UPDATE_WEB_PATH_INVALID')
    require(inventory(current_web, 'web/') == manifest['baselineWebFiles'], 'UPDATE_LIVE_WEB_BASELINE_MISMATCH')
    for reference in (IMAGE, BASE_ALIAS):
        require(not run(['docker', 'image', 'ls', '--quiet', '--no-trunc', reference]).strip(), 'UPDATE_TARGET_IMAGE_ALREADY_EXISTS')
    caddy_mounts = [item for item in caddy['Mounts'] if item['Destination'] == '/etc/caddy/Caddyfile']
    require(len(caddy_mounts) == 1 and caddy_mounts[0]['Type'] == 'bind' and not caddy_mounts[0]['RW'],
            'UPDATE_READONLY_CADDY_MOUNT_REQUIRED')
    current_caddy = Path(caddy_mounts[0]['Source'])
    require(not current_caddy.is_symlink() and current_caddy.is_file() and BASE in current_caddy.resolve().parents,
            'UPDATE_CADDY_PATH_INVALID')
    patched_caddy = patch_caddy(current_caddy.read_text(encoding='utf-8'))
    validate_caddy(patched_caddy)
    media_mounts = [item for item in api['Mounts'] if item['Destination'] == '/app/data/media-library']
    require(len(media_mounts) == 1 and media_mounts[0]['Type'] == 'bind', 'UPDATE_MEDIA_MOUNT_REQUIRED')
    current_media = Path(media_mounts[0]['Source'])
    require(not current_media.is_symlink() and current_media.is_dir() and BASE in current_media.resolve().parents,
            'UPDATE_MEDIA_PATH_INVALID')
    require(not any(item['Destination'] == DELIVERY_ROOT for item in api['Mounts']), 'UPDATE_DELIVERY_ALREADY_MOUNTED')
    coverage = verify_media_sources(current_media)
    require(coverage['matchedSources'] > 0, 'UPDATE_NO_MATCHING_PUBLIC_VIDEO_SOURCE')
    require(coverage['matchedSources'] == coverage['manifestSources'],
            'UPDATE_PUBLIC_VIDEO_SOURCE_COVERAGE_INCOMPLETE')
    return api, caddy, api_config, caddy_config, current_web, current_caddy, patched_caddy, coverage


def configure_delivery(config):
    result = copy.deepcopy(config)
    env = result['services']['api'].setdefault('environment', {})
    env['MEDIA_VIDEO_DELIVERY_ROOT'] = DELIVERY_ROOT
    env['MEDIA_VIDEO_DELIVERY_MANIFEST'] = DELIVERY_ROOT + '/manifest.json'
    # Cloud CDN requires a configured domain. Default remains the existing
    # HTTPS public media origin; enabling CDN is a separate measured rollout.
    env.setdefault('MEDIA_VIDEO_CDN_ORIGIN', '')
    result['services']['api']['volumes'].append({'type': 'bind', 'source': str(RELEASE / 'media'),
        'target': DELIVERY_ROOT, 'read_only': True, 'bind': {'create_host_path': False}})
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


def predicted_container(container, service):
    value = copy.deepcopy(container)
    if service == 'api':
        env = dict(item.split('=', 1) for item in value['Config'].get('Env', []) if '=' in item)
        env.update(MEDIA_VIDEO_DELIVERY_ROOT=DELIVERY_ROOT, MEDIA_VIDEO_DELIVERY_MANIFEST=DELIVERY_ROOT + '/manifest.json')
        env.setdefault('MEDIA_VIDEO_CDN_ORIGIN', '')
        value['Config']['Env'] = [key + '=' + item for key, item in env.items()]
        value['Mounts'].append({'Type': 'bind', 'Source': str(RELEASE / 'media'), 'Destination': DELIVERY_ROOT, 'RW': False})
    else:
        for mount in value['Mounts']:
            if mount['Destination'] == '/srv/admin':
                mount['Source'] = str(RELEASE / 'web')
            elif mount['Destination'] == '/etc/caddy/Caddyfile':
                mount['Source'] = str(RELEASE / 'Caddyfile')
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
    require(digest(Path(recovery['baselineCaddyPath']).read_bytes()) == recovery['baselineCaddySha256'],
            'UPDATE_ROLLBACK_CADDY_BASELINE_CHANGED')
    require(digest((RELEASE / 'Caddyfile').read_bytes()) == recovery['targetCaddySha256'],
            'UPDATE_TARGET_CADDY_CHANGED')


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


def verify_public_video_delivery():
    script = r'''import fs from 'node:fs';
const m=JSON.parse(fs.readFileSync('/app/data/video-delivery/manifest.json','utf8'));
const origin='https://app.outdoorfit.hk';
const get=await fetch(origin+'/api/equipment-catalog',{signal:AbortSignal.timeout(20000)});
if(!get.ok)throw Error('CATALOG');const body=await get.json(), byId=new Map(m.entries.map(e=>[e.sourceMediaId,e])), found=new Map();
for(const item of body.items||[])for(const suffix of ['Zh','En']){
 const original=item['videoUrl'+suffix],id=/^\/api\/media\/([a-f0-9-]+)\//.exec(original||'')?.[1],e=byId.get(id);if(!e)continue;
 const expected='/api/media/'+id+'/'+e.derivativeStorageName;
 const duration=item['videoIdentityDurationSeconds'+suffix];
 if(original!='/api/media/'+id+'/'+e.sourceStorageName||item['videoPlaybackUrl'+suffix]!==expected||item['videoIdentityUrl'+suffix]!==original||!Number.isFinite(duration)||Math.abs(duration-e.sourcePlaybackDurationSeconds)>0.000001)throw Error('MAPPING');
 found.set(expected,e);
}
if(found.size!==m.entries.length)throw Error('COVERAGE');
let verified=0;for(const [route,e] of found){const r=await fetch(origin+route,{method:'HEAD',signal:AbortSignal.timeout(15000)});
 if(r.status!==200||Number(r.headers.get('content-length'))!==e.derivativeSizeBytes||!/^video\/mp4\b/.test(r.headers.get('content-type')||''))throw Error('HEAD');verified++;}
console.log(JSON.stringify({ok:true,matchedVideos:found.size,verifiedHeads:verified,cdnEnabled:false}));'''
    observed = json.loads(run(['docker', 'exec', CONTAINERS['api'], 'node', '--input-type=module', '-e', script], timeout=180))
    expected = len(json.loads((RELEASE / 'media/manifest.json').read_text(encoding='utf-8'))['entries'])
    require(observed.get('ok') is True and observed.get('matchedVideos') == expected
            and observed.get('verifiedHeads') == expected, 'UPDATE_PUBLIC_VIDEO_DELIVERY_INCOMPLETE')
    return observed


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


def install(check_only=False):
    manifest = verify_package()
    api, caddy, api_config, caddy_config, current_web, current_caddy, patched_caddy, coverage = preflight(manifest)
    if check_only:
        print('VIDEO_SOURCE_MATCHES=' + str(coverage['matchedSources']), flush=True)
        print('VIDEO_CAPACITY_PREFLIGHT=PASS', flush=True)
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
    (RELEASE / 'Caddyfile').write_text(patched_caddy, encoding='utf-8')
    (RELEASE / 'Caddyfile').chmod(0o644)
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
    new_api = configure_delivery(api_config)
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
        elif item['target'] == '/etc/caddy/Caddyfile':
            item['source'] = str(RELEASE / 'Caddyfile')
    for name, value in [('api.json', new_api), ('rollback-api.json', old_api),
                        ('caddy.json', new_caddy), ('rollback-caddy.json', old_caddy)]:
        save_compose(name, value)
    recovery = {'release': PREFIX, 'services': {},
                'configHashes': {name: digest((STATE / name).read_bytes()) for name in CONFIG_FILES},
                'rollbackImages': {'api': api['Image'], 'caddy': caddy['Image']},
                'baselineWebRoot': str(current_web), 'baselineWebFiles': manifest['baselineWebFiles'],
                'baselineCaddyPath': str(current_caddy), 'baselineCaddySha256': digest(current_caddy.read_bytes()),
                'targetCaddySha256': digest((RELEASE / 'Caddyfile').read_bytes())}
    for service, container in [('api', api), ('caddy', caddy)]:
        baseline = {'configFiles': container['Config']['Labels']['com.docker.compose.project.config_files'],
                    'imageId': container['Image'], 'signature': runtime_signature(container)}
        restored = {**baseline, 'configFiles': str(STATE / ('rollback-' + service + '.json'))}
        updated = {'configFiles': str(STATE / (service + '.json')), 'imageId': new_image if service == 'api' else container['Image'],
                   'signature': runtime_signature(predicted_container(container, service))}
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
        delivery = verify_public_video_delivery()
        save('report.json', {'status': 'complete', 'image': IMAGE, 'baseline': BASELINE_IMAGE,
                             'web': str(RELEASE / 'web'), 'videoSources': coverage, 'videoDelivery': delivery, 'cdnEnabled': False})
        print('VIDEO_SOURCE_MATCHES=' + str(coverage['matchedSources']), flush=True)
        print('VIDEO_CAPACITY_UPDATE=PASS', flush=True)
    except BaseException:
        print('UPDATE_PHASE=rollback', flush=True)
        guarded_rollback(recovery, changed)
        save('report.json', {'status': 'activation_failed_rolled_back', 'release': PREFIX})
        raise


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0 and BASE.is_dir() and not BASE.is_symlink(), 'UPDATE_ROOT_AND_PRODUCTION_BASE_REQUIRED')
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument('--rollback', action='store_true')
    actions.add_argument('--check-only', action='store_true', help='Verify exact baseline without staging or activation')
    args = parser.parse_args()
    require(not (BASE / '.account-data.lock').is_symlink(), 'UPDATE_LOCK_LINK_REFUSED')
    with (BASE / '.account-data.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.rollback:
            require(STATE.is_dir() and not STATE.is_symlink(), 'UPDATE_ROLLBACK_STATE_REQUIRED')
            recovery = json.loads((STATE / 'recovery.json').read_text(encoding='utf-8'))
            guarded_rollback(recovery, ['api', 'caddy'])
            save('report.json', {'status': 'rolled_back', 'release': PREFIX})
            print('VIDEO_CAPACITY_ROLLBACK=PASS', flush=True)
        else:
            install(check_only=args.check_only)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Only internal fixed error codes are safe to print; filesystem,
        # JSON, subprocess and Compose exceptions can contain private values.
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'UPDATE_[A-Z0-9_]{1,80}', str(error)) else 'UPDATE_FAILED_REVIEW_STATE'
        print(code, file=sys.stderr)
        sys.exit(1)
