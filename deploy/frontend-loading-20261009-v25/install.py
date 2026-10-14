#!/usr/bin/env python3
"""Install only v25 web files over a verified v23 backend; never restart API."""
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
import tempfile

BASE = Path('/opt/outdoor-fit/production')
PROJECT = 'outdoor-fit-production'
PREFIX = 'outdoor-fit-frontend-loading-20261009-v25'
STATE = BASE / '.update-state/frontend-loading-20261009-v25'
RELEASE = BASE / 'releases' / PREFIX
PACKAGE = Path(__file__).resolve().parent
CONTAINERS = {name: PROJECT + '-' + name + '-1' for name in ('api', 'caddy')}
SUPPORT = {'install.py', 'README.md'}
CONFIG_FILES = ('caddy.json', 'rollback-caddy.json')
STAGE = 'initializing'
REQUIRED_API_SOURCE = {'server/src/accountContinuity.js': '8cbe87396b9b4f1d4aa7dec7fe45bdef5c6b31fb02b21cbdad63d4fc242fbd58',
 'server/src/accountDocuments.js': '42ff75c94e9d14e62b517116a093ad73bd0aa5f49dee06081826a38c7fe56bbf',
 'server/src/app.js': 'd62b1136439e700c100b90dc046f85536ab1af66c293986a2a9864c4cc608f9a',
 'server/src/appMysql.js': '137ac2e987e5548cc4501e427867df28322236af994bef476e549c2f0b324f33',
 'server/src/assistant.js': '3e11140cb444f8d1655321c049e5b5e471fde2f60b832f46e17722259c4a2c88',
 'server/src/assistantBailian.js': 'c5711754e2e7576908c922d72776fd8cb0f567233a6f921f66941c62c2333992',
 'server/src/assistantBailianChat.js': 'b0dc4ab90082e713ef49097d97b5c710bd00c9764583263fa41e224e7bd8c9cd',
 'server/src/assistantBailianFaq.js': 'b627902ef1cfdcae7c4618be10d294f8e8f3cdb50f6766dde90deff79bde5af2',
 'server/src/assistantBailianPolicy.js': 'ed95fea1275eca805aa54fe7cd6c26f897d27cc1166e72d75ea080f18b2c26d1',
 'server/src/assistantContentPolicy.js': 'f86b1e1053107d8e486fb7a44bee16787a1c7b978c341c75e1ba71ed9d7f306a',
 'server/src/assistantDeadline.js': '7b371e81820963381a3fe2ab940aa37ea9e26485a666de22727330cd5f039ec6',
 'server/src/assistantFaq.js': 'fcb67cfc1b9d7204ea919739049de2b4b394da24a196ddbc2c0bdfaea6e791ca',
 'server/src/assistantFaqKnowledge.js': 'e110df69d6b4d9ca4e85b84f271c98fd616d186a54c776e7d88d69b9b0d5b44a',
 'server/src/assistantGuide.js': '95f002d4fefde11eafb27150c42e8069910375181234e931d3e8c3bac1d1726c',
 'server/src/assistantGuideAnswers.js': '854012f3ad6d7d396013ac945f743453692aae4b5f2acb8f0fa2b0a15a985e81',
 'server/src/assistantLanguage.js': '6f175b1ad2bb39844d6098c61bb37dcfcd7d84ce6523e839e1278ae29a389c3e',
 'server/src/assistantProviderRoutes.js': 'c1c74fa8a4f07d46bdf930359cca86f736b43f0b20e7b263999d933a9d0893e8',
 'server/src/assistantProviders.js': 'b9b2a2760e3ad48d28ebf5c713a2f976895820143dc7767d7c486c3fb3394cee',
 'server/src/assistantSymptomEvidence.js': '61a82c9a87452e0bf028be3dd5ef1b93b654b0db40f43e3e5399766528b09069',
 'server/src/assistantSymptomRecommendations.js': '31d282ed2df9dbaacf390139a27661c32238936263d189b5eaf9e28b13d294bd',
 'server/src/assistantTcm.js': 'dc031c059a6271887f42aeb9a20ac192edd0faf0134ba5d9632eedc4e55eabbc',
 'server/src/equipmentCatalog.js': '5a4db4070acc275e0042dc60675da243ff99df9c1a0ddee6d39c6849be7dc2f3',
 'server/src/mysqlAssistantGuide.js': 'ac77ef6f37b41cfd95b66a9f8f108657c1533a1280bf2209066cea0550e3489b',
 'server/src/mysqlAssistantSymptomRecommendations.js': '31d282ed2df9dbaacf390139a27661c32238936263d189b5eaf9e28b13d294bd'}
BASELINE_WEB_DIGESTS = {'v23-from-v21-v15': '26a34b46d7395ea3eab5a02c298c750f1149f6d9b42b6efa03949f429289f650',
 'v23-from-v21-v16': '561521b2eb315ed6a8fdacc75d32d30fe6bfe73ea493d79893382c89ffa79b0a',
 'v23-from-v22-v20-from-v19-from-v18-from-v17-from-v15': '68b6d983ce87c1a71a68c3a1c1af4e46f706a82e2fccee4bb12bf2a69945d47a',
 'v23-from-v22-v20-from-v19-from-v18-from-v17-from-v16': '1c7dfa00b0767abc47ca4ab67c1a96e540563a761f93834d9c5154a33d2f8360',
 'v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v15': '8e13b15e46de54edde985ca59ff28b0b39f49915cb814813f2efbcf01ff5de2b',
 'v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v16': 'e2d6cadb6c68924c52c876d874d53cbe5cc68e4106947b67644f4c5a69f482c1',
 'v24-from-v23-from-v21-v15': '92cba76f05668e3bfeed63b80a148ec109405877979253358988b7c312be4a09',
 'v24-from-v23-from-v21-v16': '9044c5312cef792a241cf512147e66371d05388630f0466fc981f0f1cf1b8f8f',
 'v24-from-v23-from-v22-v20-from-v19-from-v18-from-v17-from-v15': '3c8a440c8089cc3493a5a96637cab2e91e4ca717f56ed57a3c15056718c633fa',
 'v24-from-v23-from-v22-v20-from-v19-from-v18-from-v17-from-v16': '6fe77205e16fcf4245c2bb347ab688c64540aae3c6ba57c293fa9502d3f28e18',
 'v24-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v15': '4c0fe03776997b8eacbf84a56e4ef583c702db6f11f79923df5a00ba86308a90',
 'v24-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v16': '294b2a59dc12f79f6da370e6b0e947725c49b53a699f9b59091f98225f0940db'}

def phase(name):
    global STAGE
    STAGE = name
    print('UPDATE_STAGE=' + name, flush=True)

def require(ok, code):
    if not ok:
        raise RuntimeError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def web_digest(files):
    return digest(json.dumps(files, sort_keys=True, separators=(',', ':')).encode())

def command_kind(args):
    if args[:2] == ['docker', 'compose']:
        return next(('compose_' + key for key in ('build', 'up', 'run', 'config') if key in args), 'compose')
    if args and args[0] == 'docker':
        return 'docker_' + (args[1] if len(args) > 1 and args[1] in ('exec', 'run', 'inspect', 'build', 'tag', 'image', 'ps', 'stop', 'start') else 'operation')
    return 'https' if args and args[0] == 'curl' else 'operation'

class CommandFailure(RuntimeError):
    def __init__(self, kind, exit_code=None, reason='nonzero_exit'):
        super().__init__('UPDATE_COMMAND_FAILED_' + kind.upper())
        self.details = {'stage': STAGE, 'tool': kind, 'exitCode': exit_code, 'reason': reason}

def error_details(error):
    code = str(error) if isinstance(error, RuntimeError) and re.fullmatch('UPDATE_[A-Z0-9_]{1,100}', str(error)) else 'UPDATE_FAILED_REVIEW_STATE'
    return {'code': code, **getattr(error, 'details', {'stage': STAGE})}

def run(args, timeout=180):
    # Arguments/stdout/stderr may contain credentials. Emit only a fixed tool
    # family, stage and numeric exit code, never a raw subprocess exception.
    kind = command_kind(args)
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL, text=True,
                                capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise CommandFailure(kind, reason='timeout') from None
    except OSError:
        raise CommandFailure(kind, reason='unavailable') from None
    if result.returncode:
        raise CommandFailure(kind, result.returncode)
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
    require(name in {*CONFIG_FILES, 'recovery.json', 'report.json', 'plan.json'}, 'UPDATE_STATE_NAME_INVALID')
    target = STATE / name
    require(not target.is_symlink(), 'UPDATE_STATE_LINK_REFUSED')
    temporary = target.with_name(target.name + '.partial')
    require(not temporary.is_symlink(), 'UPDATE_STATE_LINK_REFUSED')
    with temporary.open('w', encoding='utf-8') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')
        stream.flush(); os.fsync(stream.fileno())
    temporary.chmod(0o600)
    os.replace(temporary, target)
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

def mounted_file(container, destination, directory=False):
    mounted = [item for item in container['Mounts'] if item['Destination'] == destination]
    require(len(mounted) == 1 and mounted[0]['Type'] == 'bind' and not mounted[0]['RW'],
            'UPDATE_READONLY_BIND_REQUIRED')
    return below_base(mounted[0]['Source'], directory)

def observed():
    result = {}
    for service, name in CONTAINERS.items():
        present = run(['docker', 'ps', '-a', '--filter', 'name=^/' + name + '$', '--format', '{{.ID}}']).strip()
        require(not present or re.fullmatch('[a-f0-9]{12,64}', present), 'UPDATE_CONTAINER_QUERY_INVALID')
        result[service] = inspect(name) if present else None
    return result

def copy_atomic(source, target):
    require(not target.is_symlink(), 'UPDATE_TREE_LINK_REFUSED')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix='payload-', dir=STATE, delete=False) as stream:
            temporary = Path(stream.name)
            with source.open('rb') as original:
                shutil.copyfileobj(original, stream)
            stream.flush(); os.fsync(stream.fileno())
        temporary.chmod(0o644)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()

def copy_partial_tree(source, target, allowed):
    # Only dedicated, never-served v25 staging paths. Resume known partial
    # copies without removing anything or touching an older live release.
    require(not target.is_symlink() and target.resolve() == target, 'UPDATE_STAGING_PATH_INVALID')
    target.mkdir(parents=True, exist_ok=True)
    existing = inventory(target)
    require(all(name in allowed and value in allowed[name] for name, value in existing.items()), 'UPDATE_STAGING_CONTENT_CHANGED')
    for path in source.rglob('*'):
        require(not path.is_symlink(), 'UPDATE_TREE_LINK_REFUSED')
        dest = target / path.relative_to(source)
        if path.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            require(path.is_file() and not dest.is_symlink(), 'UPDATE_TREE_FILE_INVALID')
            dest.parent.mkdir(parents=True, exist_ok=True)
            copy_atomic(path, dest)


def verify_package(root=None):
    root = PACKAGE if root is None else root
    require(not (root / 'manifest.json').is_symlink(), 'UPDATE_MANIFEST_LINK_REFUSED')
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    require(manifest.get('version') == 1 and manifest.get('release') == PREFIX,
            'UPDATE_MANIFEST_RELEASE_INVALID')
    require(manifest.get('requiredApiSourceFiles') == REQUIRED_API_SOURCE, 'UPDATE_API_BASELINE_INVALID')
    files = records(manifest.get('files'))
    baselines = manifest.get('baselines')
    require(isinstance(baselines, dict) and set(baselines) == set(BASELINE_WEB_DIGESTS), 'UPDATE_BASELINES_INVALID')
    for name, baseline in baselines.items():
        web = records(baseline.get('webFiles'), 'web/')
        require(web_digest(web) == BASELINE_WEB_DIGESTS[name], 'UPDATE_BASELINE_WEB_INVALID')
    web = records(manifest.get('webFiles'), 'web/')
    require({name for name in files if not name.startswith('web/')} == SUPPORT, 'UPDATE_WEB_ONLY_PAYLOAD_REQUIRED')
    require('web/index.html' in web and all(web.get(name) == value for name, value in files.items() if name.startswith('web/')),
            'UPDATE_WEB_PAYLOAD_INVALID')
    require(all(files.get(name) == value or (name not in files and all(row['webFiles'].get(name) == value for row in baselines.values()))
                for name, value in web.items()), 'UPDATE_WEB_DELTA_INCOMPLETE')
    actual = inventory(root)
    require(set(actual) == set(files) | {'manifest.json'} and all(actual[name] == checksum for name, checksum in files.items()),
            'UPDATE_PACKAGE_HASH_MISMATCH')
    return manifest


def api_fingerprint(container):
    return {'id': container['Id'], 'stamp': stamp(container),
            'startedAt': container.get('State', {}).get('StartedAt'),
            'restartCount': container.get('RestartCount')}


def api_guard(expected=None, check_source=False):
    container = inspect(CONTAINERS['api'])
    labels = container['Config'].get('Labels', {})
    require(labels.get('com.docker.compose.project') == PROJECT and labels.get('com.docker.compose.service') == 'api',
            'UPDATE_API_PROJECT_MISMATCH')
    require(container.get('State', {}).get('Running') is True, 'UPDATE_V23_API_MUST_BE_RUNNING')
    require('ASSISTANT_PROVIDER_MODE=deepseek_only' in container['Config'].get('Env', []), 'UPDATE_INSTALL_V23_FIRST')
    if expected is not None:
        require(api_fingerprint(container) == expected, 'UPDATE_API_CHANGED_NOT_TOUCHED')
    if check_source:
        for mounted in container.get('Mounts', []):
            target = mounted['Destination'].rstrip('/')
            require(target not in ('', '/app', '/app/src') and not target.startswith('/app/src/'), 'UPDATE_API_SOURCE_SHADOWED')
        names = [name.removeprefix('server/src/') for name in sorted(REQUIRED_API_SOURCE)]
        code = "const fs=require('fs'),crypto=require('crypto'),out={};for(const n of " + json.dumps(names) + "){" \
               "const p='/app/src/'+n;if(!fs.existsSync(p)||!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw Error('SOURCE');" \
               "out['server/src/'+n]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}console.log(JSON.stringify(out));"
        actual = json.loads(run(['docker', 'exec', CONTAINERS['api'], 'node', '-e', code]))
        require(actual == REQUIRED_API_SOURCE, 'UPDATE_INSTALL_V23_FIRST')
    return api_fingerprint(container)


def preflight(manifest):
    api = api_guard(check_source=True)
    require(not STATE.exists() and not STATE.is_symlink() and not RELEASE.exists() and not RELEASE.is_symlink(),
            'UPDATE_ALREADY_PREPARED_REVIEW_STATE')
    for parent in (BASE / '.update-state', BASE / 'releases'):
        require(parent.resolve() == parent and not parent.is_symlink() and (not parent.exists() or parent.is_dir()),
                'UPDATE_PARENT_PATH_INVALID')
    caddy = inspect(CONTAINERS['caddy'])
    require(caddy.get('State', {}).get('Running') is True, 'UPDATE_COMPLETE_V23_FIRST')
    config = capture(caddy, 'caddy')
    web = mounted_file(caddy, '/srv/admin', True)
    caddyfile = mounted_file(caddy, '/etc/caddy/Caddyfile')
    actual_web = inventory(web, 'web/')
    matches = [name for name, row in manifest['baselines'].items() if actual_web == row['webFiles']]
    require(len(matches) == 1, 'UPDATE_WEB_BASELINE_REQUIRED')
    return {'release': PREFIX, 'api': api, 'caddy': caddy, 'config': config,
            'web': str(web), 'caddyfile': str(caddyfile), 'caddySha256': digest(caddyfile.read_bytes()),
            'baselineName': matches[0], 'manifestSha256': digest((PACKAGE / 'manifest.json').read_bytes())}


def prepare(check_only=False):
    phase('preflight')
    manifest = verify_package()
    if (STATE / 'recovery.json').is_file():
        recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
        current, _ = recovery_guard(recovery)
        require(digest((PACKAGE / 'manifest.json').read_bytes()) == recovery['packageManifestSha256'], 'UPDATE_DIFFERENT_PACKAGE')
        report = json.loads(below_base(STATE / 'report.json').read_text(encoding='utf-8'))
        if not check_only and report.get('status') == 'preparing':
            require(current and current['Id'] == recovery['originalId'] and stamp(current) == recovery['caddyStates'][0],
                    'UPDATE_PREPARE_HOST_CHANGED')
            save('report.json', {'status': 'prepared', 'release': PREFIX})
        print('FRONTEND_LOADING_PREFLIGHT=PASS' if check_only else 'FRONTEND_LOADING_ALREADY_PREPARED', flush=True)
        return
    if STATE.exists():
        plan = json.loads(below_base(STATE / 'plan.json').read_text(encoding='utf-8'))
        require(plan.get('release') == PREFIX and plan['manifestSha256'] == digest((PACKAGE / 'manifest.json').read_bytes()), 'UPDATE_PLAN_MISMATCH')
        api_guard(plan['api'], check_source=True)
        current = inspect(CONTAINERS['caddy'])
        require(current['Id'] == plan['caddy']['Id'] and stamp(current) == stamp(plan['caddy']) and current['State']['Running'],
                'UPDATE_PREPARE_HOST_CHANGED')
        require(inventory(below_base(plan['web'], True), 'web/') == manifest['baselines'][plan['baselineName']]['webFiles'],
                'UPDATE_BASELINE_WEB_CHANGED')
        require(digest(below_base(plan['caddyfile']).read_bytes()) == plan['caddySha256'], 'UPDATE_CADDYFILE_CHANGED')
    else:
        plan = preflight(manifest)
    if check_only:
        print('FRONTEND_LOADING_PREFLIGHT=PASS', flush=True)
        return
    if not STATE.exists():
        STATE.mkdir(parents=True, mode=0o700)
        save('plan.json', plan)
    RELEASE.mkdir(parents=True, mode=0o755, exist_ok=True)
    require(RELEASE.resolve() == RELEASE and not RELEASE.is_symlink(), 'UPDATE_STAGING_PATH_INVALID')
    save('report.json', {'status': 'preparing', 'release': PREFIX})
    phase('staging_web')
    package_files = {**manifest['files'], 'manifest.json': plan['manifestSha256']}
    copy_partial_tree(PACKAGE, RELEASE / 'package', {name: {value} for name, value in package_files.items()})
    verify_package(RELEASE / 'package')
    baseline_web = manifest['baselines'][plan['baselineName']]['webFiles']
    expected_web = {**baseline_web, **manifest['webFiles']}
    allowed = {name.removeprefix('web/'): {row[name] for row in (baseline_web, expected_web) if name in row} for name in expected_web}
    copy_partial_tree(Path(plan['web']), RELEASE / 'web', allowed)
    for name in (name for name in manifest['files'] if name.startswith('web/')):
        target = RELEASE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        copy_atomic(PACKAGE / name, target)
    for directory, _, _ in os.walk(RELEASE):
        Path(directory).chmod(0o755)
    require(inventory(RELEASE / 'web', 'web/') == expected_web, 'UPDATE_MERGED_WEB_MISMATCH')
    phase('saving_recovery')
    old, new = copy.deepcopy(plan['config']), copy.deepcopy(plan['config'])
    old['services']['caddy']['image'] = new['services']['caddy']['image'] = plan['caddy']['Image']
    predicted = copy.deepcopy(plan['caddy'])
    volumes = new['services']['caddy'].get('volumes', [])
    require(sum(item['target'] == '/srv/admin' for item in volumes) == 1, 'UPDATE_WEB_BIND_MISSING')
    for item in volumes:
        if item['target'] == '/srv/admin': item['source'] = str(RELEASE / 'web')
    for item in predicted['Mounts']:
        if item['Destination'] == '/srv/admin': item['Source'] = str(RELEASE / 'web')
    save_compose('caddy.json', new)
    save_compose('rollback-caddy.json', old)
    baseline = stamp(plan['caddy'])
    recovery = {'release': PREFIX, 'api': plan['api'], 'originalId': plan['caddy']['Id'],
                'imageId': plan['caddy']['Image'], 'baselineName': plan['baselineName'],
                'baselineWebRoot': plan['web'], 'baselineWebFiles': baseline_web, 'targetWebFiles': expected_web,
                'caddyPath': plan['caddyfile'], 'caddySha256': plan['caddySha256'], 'packageManifestSha256': plan['manifestSha256'],
                'caddyStates': [baseline, {**baseline, 'configFiles': str(STATE / 'rollback-caddy.json')},
                    {'imageId': plan['caddy']['Image'], 'configFiles': str(STATE / 'caddy.json'), 'signature': signature(predicted)}],
                'configHashes': {name: digest((STATE / name).read_bytes()) for name in CONFIG_FILES}}
    api_guard(plan['api'])
    save('recovery.json', recovery)
    save('report.json', {'status': 'prepared', 'release': PREFIX, 'apiUnchanged': True})
    print('FRONTEND_LOADING_PREPARED=PASS', flush=True)


def recovery_guard(recovery):
    require(recovery.get('release') == PREFIX and set(recovery.get('configHashes', {})) == set(CONFIG_FILES), 'UPDATE_RECOVERY_INVALID')
    api_guard(recovery['api'])
    for name, checksum in recovery['configHashes'].items():
        require(digest(below_base(STATE / name).read_bytes()) == checksum, 'UPDATE_RECOVERY_CONFIG_CHANGED')
    require(digest(below_base(RELEASE / 'package/manifest.json').read_bytes()) == recovery['packageManifestSha256'], 'UPDATE_STAGED_MANIFEST_CHANGED')
    manifest = verify_package(RELEASE / 'package')
    baseline = manifest['baselines'].get(recovery.get('baselineName'))
    require(baseline is not None and baseline['webFiles'] == recovery['baselineWebFiles'], 'UPDATE_RECOVERY_BASELINE_CHANGED')
    require(recovery['targetWebFiles'] == {**baseline['webFiles'], **manifest['webFiles']}, 'UPDATE_RECOVERY_TARGET_CHANGED')
    require(inventory(below_base(recovery['baselineWebRoot'], True), 'web/') == recovery['baselineWebFiles'], 'UPDATE_BASELINE_WEB_CHANGED')
    require(inventory(below_base(RELEASE / 'web', True), 'web/') == recovery['targetWebFiles'], 'UPDATE_TARGET_WEB_CHANGED')
    require(digest(below_base(recovery['caddyPath']).read_bytes()) == recovery['caddySha256'], 'UPDATE_CADDYFILE_CHANGED')
    require(image_id(recovery['imageId']) == recovery['imageId'], 'UPDATE_CADDY_IMAGE_UNAVAILABLE')
    current = observed()['caddy']
    if current is not None:
        require(current['Config']['Labels'].get('com.docker.compose.project') == PROJECT
                and current['Config']['Labels'].get('com.docker.compose.service') == 'caddy'
                and stamp(current) in recovery['caddyStates'], 'UPDATE_LATER_DEPLOYMENT_PRESENT')
    return current, manifest


def up(rollback=False):
    # The only service mutation this installer can issue. No API up/stop/start.
    path = STATE / ('rollback-caddy.json' if rollback else 'caddy.json')
    run(compose(path, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', 'caddy'))


def verify_https(web_root):
    expected = (web_root / 'index.html').read_bytes()
    for domain, route in [('app.outdoorfit.hk', '/'), ('admin.outdoorfit.hk', '/admin')]:
        body = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--retry', '3',
                    '--resolve', domain + ':443:127.0.0.1', 'https://' + domain + route], 75)
        require(body.encode() == expected, 'UPDATE_HTTPS_WEB_MISMATCH')
    health = json.loads(run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--retry', '3',
                             '--resolve', 'api.outdoorfit.hk:443:127.0.0.1', 'https://api.outdoorfit.hk/api/health'], 75))
    require(health.get('ok') is True, 'UPDATE_HTTPS_API_UNHEALTHY')


def rollback(recovery):
    phase('rollback_guard')
    current, _ = recovery_guard(recovery)
    if not current or stamp(current) not in recovery['caddyStates'][:2] or not current['State']['Running']:
        phase('rollback_web')
        up(rollback=True)
    current, _ = recovery_guard(recovery)
    require(current and stamp(current) in recovery['caddyStates'][:2] and current['State']['Running'], 'UPDATE_ROLLBACK_INCOMPLETE')
    verify_https(Path(recovery['baselineWebRoot']))
    api_guard(recovery['api'])
    save('report.json', {'status': 'rolled_back', 'release': PREFIX, 'apiUnchanged': True})


def apply():
    phase('activation_guard')
    recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
    status = json.loads(below_base(STATE / 'report.json').read_text(encoding='utf-8'))
    require(status.get('status') in ('prepared', 'activating', 'complete', 'rolled_back', 'rollback_failed'), 'UPDATE_NOT_PREPARED')
    current, _ = recovery_guard(recovery)
    api_guard(recovery['api'], check_source=True)
    save('report.json', {'status': 'activating', 'release': PREFIX})
    try:
        if not current or stamp(current) != recovery['caddyStates'][2] or not current['State']['Running']:
            phase('activating_web')
            up()
        current, _ = recovery_guard(recovery)
        require(current and stamp(current) == recovery['caddyStates'][2] and current['State']['Running'], 'UPDATE_WEB_NOT_ACTIVE')
        phase('https')
        verify_https(RELEASE / 'web')
        api_guard(recovery['api'])
        save('report.json', {'status': 'complete', 'release': PREFIX, 'apiUnchanged': True, 'requiredBackend': 'v23', 'web': str(RELEASE / 'web')})
        print('FRONTEND_LOADING_WEB_UPDATE=PASS', flush=True)
    except BaseException as error:
        failure = error_details(error)
        try:
            rollback(recovery)
        except BaseException as rollback_error:
            save('report.json', {'status': 'rollback_failed', 'release': PREFIX, 'activationError': failure, 'rollbackError': error_details(rollback_error)})
            raise rollback_error from None
        save('report.json', {'status': 'rolled_back', 'release': PREFIX, 'apiUnchanged': True, 'activationError': failure})
        raise


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0 and BASE.is_dir() and BASE.resolve() == BASE and not BASE.is_symlink(), 'UPDATE_ROOT_AND_PRODUCTION_BASE_REQUIRED')
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
            rollback(recovery)
            print('FRONTEND_LOADING_WEB_ROLLBACK=PASS', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(error_details(error)['code'], file=sys.stderr)
        print('UPDATE_ERROR_DETAILS=' + json.dumps(error_details(error), sort_keys=True), file=sys.stderr)
        sys.exit(1)

