#!/usr/bin/env python3
"""Guarded FAQ language repair on sealed v18 baselines."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import time

BASE = Path('/opt/outdoor-fit/production')
PROJECT = 'outdoor-fit-production'
TAG = '20261007-v19'
PREFIX = 'outdoor-fit-faq-language-' + TAG
STATE = BASE / '.update-state' / ('faq-language-' + TAG)
RELEASE = BASE / 'releases' / PREFIX
PACKAGE = Path(__file__).resolve().parent
IMAGE = 'outdoor-fit-api:' + TAG
BASE_ALIAS = 'outdoor-fit-faq-language-base:' + TAG
CONTAINERS = {name: PROJECT + '-' + name + '-1' for name in ('api', 'caddy')}
BASELINE_SOURCES = {'v18-from-v17-from-v15': {'server/src/accountContinuity.js': '1462e04b3c2bfe50fff2d22beabbf3149f24cbc8d84a531101b8f9020f42be8c', 'server/src/app.js': '31c93b605389a4021c349d13174a53c2bb7056fe0f461146b4b9f292f188b74b', 'server/src/appMysql.js': 'f4729b72d46e0e3ced0ee416051f34cb7d15dbf663adcc1122aedc7053b52231', 'server/src/assistantContentPolicy.js': 'eda8db2145518c03a2438e1458abaad4a59f86c107033fbfdffd6d0493ead062', 'server/src/assistantDeadline.js': '7b371e81820963381a3fe2ab940aa37ea9e26485a666de22727330cd5f039ec6', 'server/src/assistantFaq.js': '1dd5112da805df31256d9eb43de028aa3d190d2533d0e890d05ce8fee3abb5c5', 'server/src/assistantFaqKnowledge.js': '0e73ef849d2520a5623faeb4cdae0e70095a91912168bdf8bade1b69c4c317c8', 'server/src/assistantGuide.js': 'eafd9557314b147638a57feaee5fdd85707cf177568ef46f7ebc0fcd72250bb0', 'server/src/assistantSymptomEvidence.js': '6c96f3d5f36e21bc4e06eb83621c4e8510bec1e2ce5389642b6471ba2bd6dbf6', 'server/src/assistantSymptomRecommendations.js': '9a1d454bbefed4ef837e56681364680ba715fd230559e0168f8ac38f1afb72de', 'server/src/equipmentCatalog.js': '5a4db4070acc275e0042dc60675da243ff99df9c1a0ddee6d39c6849be7dc2f3', 'server/src/mysqlAssistantGuide.js': 'c789badfecb75d808cac8255f244c4b23364d0e40be09927cb6936d14f4b5abe', 'server/src/mysqlAssistantSymptomRecommendations.js': '9a1d454bbefed4ef837e56681364680ba715fd230559e0168f8ac38f1afb72de', 'server/src/assistant.js': 'a8558fc3dacb89506db4f16e2c8c8e1d1ba3c42e4c5e2be2d71e76b0e53cb297', 'server/src/assistantLanguage.js': None}, 'v18-from-v17-from-v16': {'server/src/accountContinuity.js': '1462e04b3c2bfe50fff2d22beabbf3149f24cbc8d84a531101b8f9020f42be8c', 'server/src/app.js': '31c93b605389a4021c349d13174a53c2bb7056fe0f461146b4b9f292f188b74b', 'server/src/appMysql.js': 'f4729b72d46e0e3ced0ee416051f34cb7d15dbf663adcc1122aedc7053b52231', 'server/src/assistantContentPolicy.js': 'eda8db2145518c03a2438e1458abaad4a59f86c107033fbfdffd6d0493ead062', 'server/src/assistantDeadline.js': '7b371e81820963381a3fe2ab940aa37ea9e26485a666de22727330cd5f039ec6', 'server/src/assistantFaq.js': '1dd5112da805df31256d9eb43de028aa3d190d2533d0e890d05ce8fee3abb5c5', 'server/src/assistantFaqKnowledge.js': '0e73ef849d2520a5623faeb4cdae0e70095a91912168bdf8bade1b69c4c317c8', 'server/src/assistantGuide.js': 'eafd9557314b147638a57feaee5fdd85707cf177568ef46f7ebc0fcd72250bb0', 'server/src/assistantSymptomEvidence.js': '6c96f3d5f36e21bc4e06eb83621c4e8510bec1e2ce5389642b6471ba2bd6dbf6', 'server/src/assistantSymptomRecommendations.js': '9a1d454bbefed4ef837e56681364680ba715fd230559e0168f8ac38f1afb72de', 'server/src/equipmentCatalog.js': '5a4db4070acc275e0042dc60675da243ff99df9c1a0ddee6d39c6849be7dc2f3', 'server/src/mysqlAssistantGuide.js': 'c789badfecb75d808cac8255f244c4b23364d0e40be09927cb6936d14f4b5abe', 'server/src/mysqlAssistantSymptomRecommendations.js': '9a1d454bbefed4ef837e56681364680ba715fd230559e0168f8ac38f1afb72de', 'server/src/assistant.js': 'a8558fc3dacb89506db4f16e2c8c8e1d1ba3c42e4c5e2be2d71e76b0e53cb297', 'server/src/assistantLanguage.js': None}}
BASELINE_WEB_DIGESTS = {'v18-from-v17-from-v15': '2e8c044a5bb97793a872b1a6ef74753f6fedee2b4464315c22295562eb7d525e', 'v18-from-v17-from-v16': '04e550440500302a32fa83c4d110275554bd667dcc3cbf18e0cb6343feccbf9c'}
NEW_SOURCE = {'server/src/assistantLanguage.js'}
UPDATE_SOURCE = set(next(iter(BASELINE_SOURCES.values())))

SUPPORT = {'Dockerfile', 'Dockerfile.dockerignore', 'install.py', 'README.md'}
CONFIG_FILES = ('api.json', 'caddy.json', 'rollback-api.json', 'rollback-caddy.json')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def web_digest(files):
    return digest(json.dumps(files, sort_keys=True, separators=(',', ':')).encode())


def run(args, timeout=180):
    # Captured inspect/Compose/DB output may contain secrets; never print it.
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, text=True,
                                capture_output=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise RuntimeError('UPDATE_COMMAND_UNAVAILABLE') from None
    require(result.returncode == 0, 'UPDATE_COMMAND_FAILED')
    return result.stdout


def safe_name(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name,
            'UPDATE_FILE_PATH_INVALID')
    relative = PurePosixPath(name)
    require(not relative.is_absolute() and '..' not in relative.parts and relative.as_posix() == name,
            'UPDATE_FILE_PATH_INVALID')
    require(not any(part.startswith('.') or part.lower() in {'private', 'secrets', 'credentials', '__pycache__'}
                    for part in relative.parts), 'UPDATE_PRIVATE_FILE_REFUSED')
    require(relative.suffix.lower() not in {'.key', '.pem', '.db', '.sqlite', '.map', '.pyc', '.docx'},
            'UPDATE_PRIVATE_FILE_REFUSED')
    return relative


def below_base(path, directory=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path and BASE in path.parents
            and not path.is_symlink() and (path.is_dir() if directory else path.is_file()),
            'UPDATE_PRODUCTION_PATH_INVALID')
    return path


def inventory(root, prefix=''):
    require(root.is_dir() and not root.is_symlink(), 'UPDATE_TREE_INVALID')
    result = {}
    for source in sorted(root.rglob('*')):
        require(not source.is_symlink(), 'UPDATE_TREE_LINK_REFUSED')
        if source.is_dir():
            continue
        require(source.is_file() and root.resolve() in source.resolve().parents, 'UPDATE_TREE_FILE_INVALID')
        name = prefix + source.relative_to(root).as_posix()
        safe_name(name)
        result[name] = digest(source.read_bytes())
    return result


def records(value, prefix=''):
    require(isinstance(value, dict) and value, 'UPDATE_MANIFEST_RECORDS_INVALID')
    for name, checksum in value.items():
        safe_name(name)
        require(name.startswith(prefix) and isinstance(checksum, str)
                and re.fullmatch('[a-f0-9]{64}', checksum), 'UPDATE_MANIFEST_HASH_INVALID')
    return value


def verify_package(root=None):
    root = PACKAGE if root is None else root
    require(not (root / 'manifest.json').is_symlink(), 'UPDATE_MANIFEST_LINK_REFUSED')
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    require(manifest.get('version') == 2 and manifest.get('release') == PREFIX,
            'UPDATE_MANIFEST_RELEASE_INVALID')
    files = records(manifest.get('files'))
    baselines = manifest.get('baselines')
    require(isinstance(baselines, dict) and set(baselines) == set(BASELINE_SOURCES), 'UPDATE_BASELINES_INVALID')
    for name, baseline in baselines.items():
        require(isinstance(baseline, dict) and baseline.get('sourceFiles') == BASELINE_SOURCES[name], 'UPDATE_BASELINE_SOURCE_INVALID')
        baseline_web = records(baseline.get('webFiles'), 'web/')
        require(web_digest(baseline_web) == BASELINE_WEB_DIGESTS[name], 'UPDATE_BASELINE_WEB_INVALID')
        require('web/index.html' in baseline_web, 'UPDATE_WEB_INDEX_REQUIRED')
    web = records(manifest.get('webFiles'), 'web/')
    require({name for name in files if not name.startswith('web/')} == UPDATE_SOURCE | SUPPORT,
            'UPDATE_PACKAGE_FILESET_INVALID')
    require(all(web.get(name) == checksum for name, checksum in files.items() if name.startswith('web/')),
            'UPDATE_WEB_PAYLOAD_INVALID')
    require(all(files.get(name) == checksum or (name not in files and all(baseline['webFiles'].get(name) == checksum for baseline in baselines.values()))
                for name, checksum in web.items()), 'UPDATE_WEB_DELTA_INCOMPLETE')
    require('web/index.html' in web, 'UPDATE_WEB_INDEX_REQUIRED')
    actual = inventory(root)
    require(set(actual) == set(files) | {'manifest.json'}
            and all(actual[name] == checksum for name, checksum in files.items()), 'UPDATE_PACKAGE_HASH_MISMATCH')
    return manifest


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
    require(name in {*CONFIG_FILES, 'recovery.json', 'report.json'}, 'UPDATE_STATE_NAME_INVALID')
    target = STATE / name
    require(not target.is_symlink(), 'UPDATE_STATE_LINK_REFUSED')
    target.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')
    target.chmod(0o600)
    return target


def save_compose(name, config):
    target = save(name, literal_compose(config))
    require(json.loads(run(compose(target, 'config', '--format', 'json'))) == config,
            'UPDATE_COMPOSE_ROUNDTRIP_MISMATCH')
    return target


def capture(container, service):
    labels = container['Config']['Labels']
    require(labels.get('com.docker.compose.project') == PROJECT
            and labels.get('com.docker.compose.service') == service, 'UPDATE_PROJECT_MISMATCH')
    paths = labels.get('com.docker.compose.project.config_files', '').split(',')
    require(paths and all(paths), 'UPDATE_COMPOSE_LABEL_REQUIRED')
    command = ['docker', 'compose', '--project-name', PROJECT]
    env_file = below_base(BASE / 'secrets/production.env')
    command += ['--env-file', str(env_file)]
    for name in paths:
        command += ['-f', str(below_base(name))]
    config = json.loads(run(command + ['config', '--format', 'json']))
    require(set(config.get('services', {})) == {'api', 'caddy'}, 'UPDATE_SERVICES_REQUIRE_REVIEW')
    resolved = config['services'][service]
    require(image_id(resolved['image']) == container['Image'], 'UPDATE_IMAGE_CONFIG_DRIFT')
    env = dict(item.split('=', 1) for item in container['Config'].get('Env', []) if '=' in item)
    require(all(env.get(key) == str(value) for key, value in resolved.get('environment', {}).items()),
            'UPDATE_ENV_CONFIG_DRIFT')
    mounts = {item['Destination']: item for item in container['Mounts']}
    for volume in resolved.get('volumes', []):
        if volume['type'] == 'bind':
            mounted = mounts.get(volume['target'], {})
            require(mounted.get('Type') == 'bind' and mounted.get('Source') == volume['source']
                    and mounted.get('RW') == (not volume.get('read_only', False)), 'UPDATE_MOUNT_CONFIG_DRIFT')
    for key, image_key in [('entrypoint', 'Entrypoint'), ('command', 'Cmd')]:
        if resolved.get(key) is not None:
            require(resolved[key] == container['Config'].get(image_key), 'UPDATE_STARTUP_CONFIG_DRIFT')
    return config


def signature(container):
    config, host = container['Config'], container.get('HostConfig', {})
    value = {'environment': sorted(config.get('Env', [])),
             'config': {key: config.get(key) for key in ('Cmd', 'Entrypoint', 'User', 'WorkingDir', 'ExposedPorts', 'Healthcheck')},
             'labels': {key: value for key, value in config.get('Labels', {}).items() if not key.startswith('com.docker.compose.')},
             'mounts': sorted(({key: item.get(key) for key in ('Type', 'Source', 'Destination', 'RW')}
                              for item in container.get('Mounts', [])), key=lambda item: item['Destination']),
             'networks': sorted(container.get('NetworkSettings', {}).get('Networks', {})),
             'host': {key: host.get(key) for key in ('NanoCpus', 'Memory', 'MemorySwap', 'PidsLimit', 'ReadonlyRootfs',
                      'Privileged', 'NetworkMode', 'CapAdd', 'CapDrop', 'SecurityOpt', 'RestartPolicy', 'PortBindings', 'Tmpfs',
                      'ExtraHosts', 'Dns', 'DnsSearch', 'GroupAdd', 'LogConfig', 'Init')}}
    return digest(json.dumps(value, sort_keys=True).encode())


def stamp(container):
    labels = container['Config']['Labels']
    return {'configFiles': labels.get('com.docker.compose.project.config_files'),
            'imageId': container['Image'], 'signature': signature(container)}


def source_hashes():
    names = [name.removeprefix('server/src/') for name in sorted(UPDATE_SOURCE)]
    code = "const fs=require('fs'),crypto=require('crypto'),out={};for(const n of " + json.dumps(names) + "){" \
           "const p='/app/src/'+n;if(!fs.existsSync(p)){out['server/src/'+n]=null;continue;}if(!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw Error('SOURCE');" \
           "out['server/src/'+n]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}console.log(JSON.stringify(out));"
    return json.loads(run(['docker', 'exec', CONTAINERS['api'], 'node', '-e', code]))


def mounted_file(container, destination, directory=False):
    mounted = [item for item in container['Mounts'] if item['Destination'] == destination]
    require(len(mounted) == 1 and mounted[0]['Type'] == 'bind' and not mounted[0]['RW'],
            'UPDATE_READONLY_BIND_REQUIRED')
    return below_base(mounted[0]['Source'], directory)


def preflight(manifest):
    require(not STATE.exists() and not STATE.is_symlink() and not RELEASE.exists() and not RELEASE.is_symlink(),
            'UPDATE_ALREADY_PREPARED_REVIEW_STATE')
    for parent in (BASE / '.update-state', BASE / 'releases'):
        require(parent.resolve() == parent and not parent.is_symlink()
                and (not parent.exists() or parent.is_dir()), 'UPDATE_PARENT_PATH_INVALID')
    containers = {name: inspect(value) for name, value in CONTAINERS.items()}
    require(all(value['State']['Running'] for value in containers.values()), 'UPDATE_SERVICES_NOT_RUNNING')
    configs = {name: capture(value, name) for name, value in containers.items()}
    actual_sources = source_hashes()
    matches = [name for name, source in BASELINE_SOURCES.items() if actual_sources == source]
    require(matches, 'UPDATE_SOURCE_BASELINE_MISMATCH')
    for mount in containers['api']['Mounts']:
        target = mount['Destination'].rstrip('/')
        require(target not in ('', '/app', '/app/src') and not target.startswith('/app/src/'),
                'UPDATE_SOURCE_MOUNT_SHADOWS_IMAGE')
    web = mounted_file(containers['caddy'], '/srv/admin', directory=True)
    caddyfile = mounted_file(containers['caddy'], '/etc/caddy/Caddyfile')
    # v18 preserves previous hashed assets; accept only the sealed merged trees.
    actual_web = inventory(web, 'web/')
    pairs = [name for name in matches if actual_web == manifest['baselines'][name]['webFiles']]
    require(len(pairs) == 1, 'UPDATE_WEB_BASELINE_MISMATCH')
    baseline_name = pairs[0]
    # Stop Caddy before applying; the API must not have another public ingress.
    for bindings in containers['api'].get('HostConfig', {}).get('PortBindings', {}).values():
        require(all(item.get('HostIp') in ('127.0.0.1', '::1') for item in bindings or []),
                'UPDATE_API_PUBLIC_PORT_REQUIRES_REVIEW')
    require(containers['api'].get('HostConfig', {}).get('NetworkMode') != 'host', 'UPDATE_HOST_NETWORK_REFUSED')
    for image in (IMAGE, BASE_ALIAS):
        require(not run(['docker', 'image', 'ls', '--quiet', '--no-trunc', image]).strip(), 'UPDATE_TARGET_IMAGE_EXISTS')
    return containers, configs, web, caddyfile, baseline_name


def no_pending_jobs():
    code = r"""import fs from 'node:fs';import mysql from 'mysql2/promise';import {readMysqlConfig} from './src/mysqlConfig.js';
let connection;const deadline=setTimeout(()=>process.exit(2),15000);
try{const env={...process.env,MYSQL_PASSWORD:fs.readFileSync(process.env.MYSQL_PASSWORD_FILE,'utf8')};
connection=await mysql.createConnection(readMysqlConfig(env));
const [rows]=await connection.query({sql:"SELECT COUNT(*) AS n FROM assistant_jobs WHERE status IN ('queued','running')",timeout:8000});
console.log(JSON.stringify({pending:Number(rows[0].n)}));}
catch{process.exitCode=1;}finally{if(connection)await connection.end();clearTimeout(deadline);}"""
    value = json.loads(run(['docker', 'exec', '-w', '/app', CONTAINERS['api'], 'node', '--input-type=module', '-e', code], 20))
    require(type(value.get('pending')) is int and value['pending'] == 0, 'UPDATE_AI_BUSY_TRY_LATER')


def prepare(check_only=False):
    manifest = verify_package()
    containers, configs, web, caddyfile, baseline_name = preflight(manifest)
    no_pending_jobs()
    if check_only:
        print('FAQ_LANGUAGE_PREFLIGHT_OK', flush=True)
        return
    STATE.mkdir(parents=True, mode=0o700)
    RELEASE.mkdir(parents=True, mode=0o755)
    save('report.json', {'status': 'preparing', 'release': PREFIX})
    # Keep the sealed package separate from the merged served web directory.
    shutil.copytree(PACKAGE, RELEASE / 'package')
    verify_package(RELEASE / 'package')
    shutil.copytree(web, RELEASE / 'web')
    for name in (name for name in manifest['files'] if name.startswith('web/')):
        target = RELEASE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(PACKAGE / name, target)
        target.chmod(0o644)
    for directory, _, _ in os.walk(RELEASE):
        Path(directory).chmod(0o755)
    baseline_web = manifest['baselines'][baseline_name]['webFiles']
    expected_web = {**baseline_web, **manifest['webFiles']}
    require(inventory(RELEASE / 'web', 'web/') == expected_web, 'UPDATE_MERGED_WEB_MISMATCH')
    run(['docker', 'tag', containers['api']['Image'], BASE_ALIAS])
    require(image_id(BASE_ALIAS) == containers['api']['Image'], 'UPDATE_BASE_IMAGE_CHANGED')
    run(['docker', 'build', '--pull=false', '--network=none', '--build-arg', 'BASE_IMAGE=' + BASE_ALIAS,
         '-t', IMAGE, str(RELEASE / 'package')], 600)
    candidate = image_id(IMAGE)
    recovery = {'release': PREFIX, 'services': {}, 'originalIds': {}, 'rollbackImages': {},
                'baselineName': baseline_name, 'baselineSourceFiles': BASELINE_SOURCES[baseline_name],
                'baselineWebRoot': str(web), 'baselineWebFiles': baseline_web,
                'targetWebFiles': expected_web, 'caddyPath': str(caddyfile), 'caddySha256': digest(caddyfile.read_bytes()),
                'packageManifestSha256': digest((RELEASE / 'package/manifest.json').read_bytes())}
    for service in ('api', 'caddy'):
        old, new = copy.deepcopy(configs[service]), copy.deepcopy(configs[service])
        old['services'][service]['image'] = containers[service]['Image']
        new['services'][service]['image'] = candidate if service == 'api' else containers[service]['Image']
        predicted = copy.deepcopy(containers[service])
        if service == 'caddy':
            volumes = new['services'][service].get('volumes', [])
            require(sum(item['target'] == '/srv/admin' for item in volumes) == 1, 'UPDATE_WEB_BIND_MISSING')
            for item in volumes:
                if item['target'] == '/srv/admin':
                    item['source'] = str(RELEASE / 'web')
            for item in predicted['Mounts']:
                if item['Destination'] == '/srv/admin':
                    item['Source'] = str(RELEASE / 'web')
        save_compose(service + '.json', new)
        save_compose('rollback-' + service + '.json', old)
        baseline = stamp(containers[service])
        recovery['services'][service] = [baseline,
            {**baseline, 'configFiles': str(STATE / ('rollback-' + service + '.json'))},
            {'configFiles': str(STATE / (service + '.json')), 'imageId': new['services'][service]['image'], 'signature': signature(predicted)}]
        recovery['originalIds'][service] = containers[service]['Id']
        recovery['rollbackImages'][service] = containers[service]['Image']
    recovery['configHashes'] = {name: digest((STATE / name).read_bytes()) for name in CONFIG_FILES}
    save('recovery.json', recovery)
    save('report.json', {'status': 'prepared', 'release': PREFIX})
    print('FAQ_LANGUAGE_PREPARED_OLD_SERVICES_STILL_RUNNING', flush=True)


def observed():
    result = {}
    for service, name in CONTAINERS.items():
        present = run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
        require(not present or re.fullmatch('[a-f0-9]{12,64}', present), 'UPDATE_CONTAINER_QUERY_INVALID')
        result[service] = inspect(name) if present else None
    return result


def recovery_guard(recovery):
    require(recovery.get('release') == PREFIX and set(recovery.get('configHashes', {})) == set(CONFIG_FILES),
            'UPDATE_RECOVERY_INVALID')
    for name, checksum in recovery['configHashes'].items():
        require(digest(below_base(STATE / name).read_bytes()) == checksum, 'UPDATE_RECOVERY_CONFIG_CHANGED')
    require(digest(below_base(RELEASE / 'package/manifest.json').read_bytes()) == recovery['packageManifestSha256'],
            'UPDATE_STAGED_MANIFEST_CHANGED')
    manifest = verify_package(RELEASE / 'package')
    baseline = manifest['baselines'].get(recovery.get('baselineName'))
    require(baseline is not None and recovery.get('baselineSourceFiles') == baseline['sourceFiles']
            and recovery['baselineWebFiles'] == baseline['webFiles'], 'UPDATE_RECOVERY_BASELINE_CHANGED')
    require(inventory(below_base(recovery['baselineWebRoot'], True), 'web/') == recovery['baselineWebFiles'],
            'UPDATE_BASELINE_WEB_CHANGED')
    require(inventory(below_base(RELEASE / 'web', True), 'web/') == recovery['targetWebFiles'], 'UPDATE_TARGET_WEB_CHANGED')
    require(digest(below_base(recovery['caddyPath']).read_bytes()) == recovery['caddySha256'], 'UPDATE_CADDYFILE_CHANGED')
    for image in recovery['rollbackImages'].values():
        require(image_id(image) == image, 'UPDATE_ROLLBACK_IMAGE_UNAVAILABLE')
    current = observed()
    for service, container in current.items():
        if container is None:
            continue
        require(container['Config']['Labels'].get('com.docker.compose.project') == PROJECT
                and container['Config']['Labels'].get('com.docker.compose.service') == service
                and stamp(container) in recovery['services'][service], 'UPDATE_LATER_DEPLOYMENT_PRESENT')
    return current, manifest


def up(service, rollback=False):
    config = STATE / (('rollback-' if rollback else '') + service + '.json')
    run(compose(config, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service))


def health():
    code = "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>r.json()).then(r=>process.exit(r.ok&&r.service==='outdoor-fit-api'?0:1)).catch(()=>process.exit(1))"
    for attempt in range(24):
        try:
            run(['docker', 'exec', CONTAINERS['api'], 'node', '-e', code], 10)
            return
        except RuntimeError:
            if attempt < 23:
                time.sleep(2)
    raise RuntimeError('UPDATE_HEALTH_FAILED')


def verify_https(web_root):
    expected = (web_root / 'index.html').read_bytes()
    for domain, route in [('app.outdoorfit.hk', '/'), ('admin.outdoorfit.hk', '/admin')]:
        body = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--retry', '3',
                    '--resolve', domain + ':443:127.0.0.1', 'https://' + domain + route], 75)
        require(body.encode() == expected, 'UPDATE_HTTPS_WEB_MISMATCH')
    response = json.loads(run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--retry', '3',
                              '--resolve', 'api.outdoorfit.hk:443:127.0.0.1', 'https://api.outdoorfit.hk/api/health'], 75))
    require(response.get('ok') is True, 'UPDATE_HTTPS_API_UNHEALTHY')


def rollback(recovery, services=('api', 'caddy')):
    current, _ = recovery_guard(recovery)
    # A candidate can accept work after Caddy restarts but before HTTPS checks
    # finish. Re-closing ingress is mandatory before an automatic API rollback.
    # If a request entered that window, keep its worker alive and leave an
    # explicit retryable rollback state instead of interrupting accepted work.
    if 'api' in services and current['caddy'] and current['caddy']['State']['Running']:
        run(['docker', 'stop', '--time', '90', CONTAINERS['caddy']], 110)
        try:
            if current['api'] and current['api']['State']['Running']:
                no_pending_jobs()
        except BaseException as error:
            code = 'UPDATE_ROLLBACK_WAITING_FOR_AI' if str(error) == 'UPDATE_AI_BUSY_TRY_LATER' else 'UPDATE_ROLLBACK_AI_CHECK_FAILED'
            save('report.json', {'status': 'rollback_blocked', 'release': PREFIX, 'reason': code})
            run(['docker', 'start', CONTAINERS['caddy']])
            raise RuntimeError(code) from None
    failures = []
    for service in services:
        try:
            up(service, rollback=True)
            if service == 'api':
                health()
        except BaseException:
            failures.append(service)
    require(not failures, 'UPDATE_ROLLBACK_INCOMPLETE_REVIEW_STATE')
    verify_https(Path(recovery['baselineWebRoot']))
    save('report.json', {'status': 'rolled_back', 'release': PREFIX})


def manual_rollback(recovery):
    current, _ = recovery_guard(recovery)
    api_running = current['api'] and current['api']['State']['Running']
    if api_running:
        no_pending_jobs()
    caddy_running = current['caddy'] and current['caddy']['State']['Running']
    if caddy_running:
        run(['docker', 'stop', '--time', '90', CONTAINERS['caddy']], 110)
    try:
        if api_running:
            no_pending_jobs()
    except BaseException:
        if caddy_running:
            run(['docker', 'start', CONTAINERS['caddy']])
        raise
    rollback(recovery)


def apply():
    recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
    status = json.loads(below_base(STATE / 'report.json').read_text(encoding='utf-8'))
    require(status.get('status') == 'prepared', 'UPDATE_NOT_PREPARED_REVIEW_STATE')
    current, manifest = recovery_guard(recovery)
    require(all(current[name] and current[name]['State']['Running']
                and current[name]['Id'] == recovery['originalIds'][name] for name in ('api', 'caddy')),
            'UPDATE_BASELINE_CONTAINER_CHANGED')
    require(source_hashes() == recovery['baselineSourceFiles'], 'UPDATE_SOURCE_BASELINE_MISMATCH')
    no_pending_jobs()
    changed = []
    try:
        # Close public ingress first, then recheck jobs after Caddy has drained.
        # Never run a second production worker against the same RDS.
        changed.append('caddy')
        run(['docker', 'stop', '--time', '90', CONTAINERS['caddy']], 110)
        no_pending_jobs()
        changed.insert(0, 'api')
        up('api')
        health()
        require(source_hashes() == {name: manifest['files'][name] for name in UPDATE_SOURCE},
                'UPDATE_RUNNING_SOURCE_MISMATCH')
        up('caddy')
        recovery_guard(recovery)
        verify_https(RELEASE / 'web')
        save('report.json', {'status': 'complete', 'release': PREFIX, 'fromBaseline': recovery['baselineName'], 'idleLogoutMinutes': 90,
                             'web': str(RELEASE / 'web'), 'liveAiLoadTest': 'not_performed_by_installer'})
        print('FAQ_LANGUAGE_UPDATE=PASS', flush=True)
    except BaseException:
        if changed == ['caddy']:
            # Queue became busy during ingress draining: resume precisely the
            # unchanged container, leaving the prepared state retryable.
            recovery_guard(recovery)
            run(['docker', 'start', CONTAINERS['caddy']])
            verify_https(Path(recovery['baselineWebRoot']))
            print('FAQ_LANGUAGE_NOT_APPLIED_OLD_SERVICES_RESUMED', flush=True)
            raise
        rollback(recovery, changed)
        print('FAQ_LANGUAGE_ACTIVATION_FAILED_ROLLED_BACK', flush=True)
        raise


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0 and BASE.is_dir() and BASE.resolve() == BASE and not BASE.is_symlink(),
            'UPDATE_ROOT_AND_PRODUCTION_BASE_REQUIRED')
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    for option in ('check-only', 'prepare', 'apply', 'rollback'):
        group.add_argument('--' + option, action='store_true')
    args = parser.parse_args()
    lock_path = BASE / '.account-data.lock'
    require(not lock_path.is_symlink(), 'UPDATE_LOCK_LINK_REFUSED')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.check_only or args.prepare:
            prepare(check_only=args.check_only)
        elif args.apply:
            apply()
        else:
            recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
            manual_rollback(recovery)
            print('FAQ_LANGUAGE_ROLLBACK_OK', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('UPDATE_[A-Z0-9_]{1,80}', str(error)) else 'UPDATE_FAILED_REVIEW_STATE'
        print(code, file=sys.stderr)
        sys.exit(1)
