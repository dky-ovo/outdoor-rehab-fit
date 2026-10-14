#!/usr/bin/env python3
"""Resumable exercise-video categories update on independently sealed API and web baselines."""
import argparse
import copy
import hashlib
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path('/opt/outdoor-fit/production')
PROJECT = 'outdoor-fit-production'
TAG = '20261012-v26'
PREFIX = 'outdoor-fit-exercise-video-categories-' + TAG
STATE = BASE / '.update-state' / ('exercise-video-categories-' + TAG)
RELEASE = BASE / 'releases' / PREFIX
PACKAGE = Path(__file__).resolve().parent
IMAGE = 'outdoor-fit-api:' + TAG
BASE_ALIAS = 'outdoor-fit-exercise-video-categories-base:' + TAG
CONTAINERS = {name: PROJECT + '-' + name + '-1' for name in ('api', 'caddy')}
# Baselines derive from SHA-verified immutable v23 API and v23/v24/v25 web archives.
API_SOURCE_BASELINE = {
    'server/src/database.js': 'f5c43fb4aed3955950bbd63209387a37529fff0267f2c163621e49d9ba7cb337',
    'server/src/exerciseVideoMetadataSchema.js': None,
'server/scripts/migrate-exercise-video-metadata.js': None,
 'server/src/accountContinuity.js': '8cbe87396b9b4f1d4aa7dec7fe45bdef5c6b31fb02b21cbdad63d4fc242fbd58',
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
 'server/src/exerciseVideoMetadata.js': None,
 'server/src/mysqlAssistantGuide.js': 'ac77ef6f37b41cfd95b66a9f8f108657c1533a1280bf2209066cea0550e3489b',
 'server/src/mysqlAssistantSymptomRecommendations.js': '31d282ed2df9dbaacf390139a27661c32238936263d189b5eaf9e28b13d294bd'}
WEB_BASELINE_DIGESTS = {'v23-from-v21-v15': '26a34b46d7395ea3eab5a02c298c750f1149f6d9b42b6efa03949f429289f650',
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
 'v24-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v16': '294b2a59dc12f79f6da370e6b0e947725c49b53a699f9b59091f98225f0940db',
 'v25-from-v23-from-v21-v15': '0151d5c8fdc0556c899db744e75d3f571a913e9db36ed642592820307af9513b',
 'v25-from-v23-from-v21-v16': '2ff0e1b6d128c3cabb06509212386c75d879f2e30d70a51c29d48915f07c6f77',
 'v25-from-v23-from-v22-v20-from-v19-from-v18-from-v17-from-v15': '0fe66ff1155ac333b3ecf4ff1c9135c78aed45a383e9d89cd51580eb88dc1e79',
 'v25-from-v23-from-v22-v20-from-v19-from-v18-from-v17-from-v16': '949c8bbb31ca59b91ac4fbc6bd80fb7f48d85b60fee04c2319833b28df6725a5',
 'v25-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v15': '0651afc4851a7c8431c147bee61f2ce131ef26bc0a4cf72459e8510fe2edb1dd',
 'v25-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v16': '589cbdcda88c7be7f3591f3bf4f5b8f6fd51ef73d215489ffc2e373739259b6c',
 'v25-from-v24-from-v23-from-v21-v15': 'a7592a7bdc44747877b92b2c6885b1e0c5b44559845843ebb93d6add2bd81476',
 'v25-from-v24-from-v23-from-v21-v16': 'e57c68afdef856a49a97721cba6dd908319c21bd9fc02dee1e975517a85bcce3',
 'v25-from-v24-from-v23-from-v22-v20-from-v19-from-v18-from-v17-from-v15': '1b2808b3916167c8b9759932ba3a2a96b49f387558604c8ff53980b13b24f75c',
 'v25-from-v24-from-v23-from-v22-v20-from-v19-from-v18-from-v17-from-v16': 'be87ee990b7e1107a30e8afff02c3ae694c7225d86139155e1fa56a860200981',
 'v25-from-v24-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v15': '2896e503fb293aae67b4be6f2563b4d87ef84fbe2fcfbc6115de54fc3b089f7e',
 'v25-from-v24-from-v23-from-v22-v21-from-v20-from-v19-from-v18-from-v17-from-v16': '54ddab37e9bcfe28e709acb42595ed1aae744b2de59867416c88cb2668678551'}
BASELINE_SOURCES = {name: API_SOURCE_BASELINE.copy() for name in WEB_BASELINE_DIGESTS}
BASELINE_WEB_DIGESTS = WEB_BASELINE_DIGESTS.copy()
NEW_SOURCE = {'server/src/exerciseVideoMetadataSchema.js', 'server/scripts/migrate-exercise-video-metadata.js', 'server/src/exerciseVideoMetadata.js'}
UPDATE_SOURCE = set(API_SOURCE_BASELINE)

SUPPORT = {'Dockerfile', 'Dockerfile.dockerignore', 'install.py', 'README.md'}
CONFIG_FILES = ('api.json', 'caddy.json', 'rollback-api.json', 'rollback-caddy.json')
DEEPSEEK_ENV = {'ASSISTANT_PROVIDER_MODE': 'deepseek_only'}
STAGE = 'initializing'


def phase(name):
    global STAGE
    STAGE = name
    print('UPDATE_STAGE=' + name, flush=True)


def add_target_configuration(service, predicted):
    # This release does not change any provider, key, network or runtime setting.
    environment = service.get('environment', {})
    env = dict(item.split('=', 1) for item in predicted['Config'].get('Env', []) if '=' in item)
    require(isinstance(environment, dict) and environment.get('ASSISTANT_PROVIDER_MODE') == 'deepseek_only'
            and env.get('ASSISTANT_PROVIDER_MODE') == 'deepseek_only', 'UPDATE_DEEPSEEK_MODE_BASELINE_REQUIRED')


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


def run(args, timeout=180, data=None):
    # Arguments/stdout/stderr may contain credentials. Emit only a fixed tool
    # family, stage and numeric exit code, never a raw subprocess exception.
    kind = command_kind(args)
    try:
        result = subprocess.run(args, **({'stdin': subprocess.DEVNULL} if data is None else {'input': data}),
                                text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise CommandFailure(kind, reason='timeout') from None
    except OSError:
        raise CommandFailure(kind, reason='unavailable') from None
    if result.returncode:
        failure = CommandFailure(kind, result.returncode)
        codes = re.findall(r'^ERROR_CODE=([A-Z0-9_]{1,80})$', result.stdout + '\n' + result.stderr, re.MULTILINE)
        if codes and STAGE in ('schema_check', 'schema_apply'):
            failure.details['databaseCode'] = codes[-1]
        raise failure
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
    require(name in {*CONFIG_FILES, 'recovery.json', 'report.json', 'plan.json', 'schema-report.json'}, 'UPDATE_STATE_NAME_INVALID')
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


def source_hashes(image=None):
    names = [name.removeprefix('server/') for name in sorted(UPDATE_SOURCE)]
    code = "const fs=require('fs'),crypto=require('crypto'),out={};for(const n of " + json.dumps(names) + "){" \
           "const p='/app/'+n;if(!fs.existsSync(p)){out['server/'+n]=null;continue;}if(!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw Error('SOURCE');" \
           "out['server/'+n]=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}console.log(JSON.stringify(out));"
    container = inspect(CONTAINERS['api']) if image is None else None
    if container and container['State']['Running']:
        command = ['docker', 'exec', CONTAINERS['api'], 'node', '-e', code]
    else:
        command = ['docker', 'run', '--rm', '--network', 'none', '--read-only', '--entrypoint', 'node', image or container['Image'], '-e', code]
    return json.loads(run(command))


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
    require(all(value.get('State', {}).get('Status') not in ('restarting', 'removing', 'paused') for value in containers.values()), 'UPDATE_SERVICES_TRANSITIONING')
    configs = {name: capture(value, name) for name, value in containers.items()}
    add_target_configuration(copy.deepcopy(configs['api']['services']['api']), copy.deepcopy(containers['api']))
    actual_sources = source_hashes()
    matches = [name for name, source in BASELINE_SOURCES.items() if actual_sources == source]
    require(matches, 'UPDATE_SOURCE_BASELINE_MISMATCH')
    for mount in containers['api']['Mounts']:
        target = mount['Destination'].rstrip('/')
        require(target not in ('', '/app', '/app/src', '/app/scripts') and not target.startswith(('/app/src/', '/app/scripts/')),
                'UPDATE_SOURCE_MOUNT_SHADOWS_IMAGE')
    web = mounted_file(containers['caddy'], '/srv/admin', directory=True)
    caddyfile = mounted_file(containers['caddy'], '/etc/caddy/Caddyfile')
    # Earlier releases preserve previous hashed assets; accept only the sealed merged trees.
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
    current = observed()['api']
    if current and current['State']['Running']:
        command = ['docker', 'exec', '-w', '/app', CONTAINERS['api'], 'node', '--input-type=module', '-e', code]
    else:
        # A one-shot SQL client, never src/production.js or a second worker.
        if current:
            definition = capture(current, 'api')['services']['api']
            require(not definition.get('build') and definition.get('pull_policy') != 'build', 'UPDATE_PROBE_BUILD_CONFIG_REFUSED')
            paths = current['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
            command = ['docker', 'compose', '--project-name', PROJECT, '--env-file', str(below_base(BASE / 'secrets/production.env'))]
            for path in paths:
                command += ['-f', str(below_base(path))]
        else:
            probe_config = below_base(STATE / 'rollback-api.json')
            definition = json.loads(run(compose(probe_config, 'config', '--format', 'json')))['services']['api']
            require(not definition.get('build') and definition.get('pull_policy') != 'build', 'UPDATE_PROBE_BUILD_CONFIG_REFUSED')
            command = compose(probe_config)
        command += ['run', '--rm', '--no-deps', '--pull', 'never', '-T', '--entrypoint', 'node',
                    'api', '--input-type=module', '-e', code]
    value = json.loads(run(command, 30))
    require(type(value.get('pending')) is int and value['pending'] == 0, 'UPDATE_AI_BUSY_TRY_LATER')


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
    # Only dedicated, never-served v26 staging paths. Resume known partial
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



def prepare(check_only=False):
    phase('preflight')
    manifest = verify_package()
    if (STATE / 'recovery.json').is_file():
        recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
        recovery_guard(recovery)
        require(digest((PACKAGE / 'manifest.json').read_bytes()) == recovery['packageManifestSha256'], 'UPDATE_DIFFERENT_PACKAGE')
        report = json.loads(below_base(STATE / 'report.json').read_text(encoding='utf-8'))
        if not check_only and report.get('status') == 'preparing':
            # A crash after committing recovery but before the prepared marker.
            now = observed()
            require(all(now[name] and now[name]['Id'] == recovery['originalIds'][name]
                        and stamp(now[name]) == recovery['services'][name][0]
                        and now[name]['State']['Running'] == recovery['originalRunning'][name] for name in CONTAINERS),
                    'UPDATE_PREPARE_HOST_CHANGED')
            save('report.json', {'status': 'prepared', 'release': PREFIX})
        schema_probe()
        print('EXERCISE_VIDEO_CATEGORIES_PREFLIGHT_OK' if check_only else 'EXERCISE_VIDEO_CATEGORIES_ALREADY_PREPARED', flush=True)
        return
    if STATE.exists():
        plan = json.loads(below_base(STATE / 'plan.json').read_text(encoding='utf-8'))
        require(plan.get('release') == PREFIX and plan['manifestSha256'] == digest((PACKAGE / 'manifest.json').read_bytes()), 'UPDATE_PLAN_MISMATCH')
        containers, configs = plan['containers'], plan['configs']
        for name, old in containers.items():
            now = inspect(CONTAINERS[name])
            require(now['Id'] == old['Id'] and stamp(now) == stamp(old) and now['State']['Running'] == old['State']['Running'], 'UPDATE_PREPARE_HOST_CHANGED')
        web, caddyfile, baseline_name = Path(plan['web']), Path(plan['caddyfile']), plan['baselineName']
        require(inventory(below_base(web, True), 'web/') == manifest['baselines'][baseline_name]['webFiles'], 'UPDATE_BASELINE_WEB_CHANGED')
        require(digest(below_base(caddyfile).read_bytes()) == plan['caddySha256'], 'UPDATE_CADDYFILE_CHANGED')
        require(source_hashes() == BASELINE_SOURCES[baseline_name], 'UPDATE_SOURCE_BASELINE_MISMATCH')
    else:
        containers, configs, web, caddyfile, baseline_name = preflight(manifest)
        plan = {'release': PREFIX, 'containers': containers, 'configs': configs, 'web': str(web),
                'caddyfile': str(caddyfile), 'baselineName': baseline_name,
                'manifestSha256': digest((PACKAGE / 'manifest.json').read_bytes()),
                'caddySha256': digest(caddyfile.read_bytes()), 'buildStarted': False}
    no_pending_jobs()
    if check_only:
        print('EXERCISE_VIDEO_CATEGORIES_PREFLIGHT_OK', flush=True)
        return
    if not STATE.exists():
        STATE.mkdir(parents=True, mode=0o700)
        save('plan.json', plan)
    RELEASE.mkdir(parents=True, mode=0o755, exist_ok=True)
    require(RELEASE.resolve() == RELEASE and not RELEASE.is_symlink(), 'UPDATE_STAGING_PATH_INVALID')
    save('report.json', {'status': 'preparing', 'release': PREFIX})
    phase('staging')
    package_files = {**manifest['files'], 'manifest.json': plan['manifestSha256']}
    copy_partial_tree(PACKAGE, RELEASE / 'package', {name: {value} for name, value in package_files.items()})
    verify_package(RELEASE / 'package')
    baseline_web = manifest['baselines'][baseline_name]['webFiles']
    expected_web = {**baseline_web, **manifest['webFiles']}
    allowed = {name.removeprefix('web/'): {row[name] for row in (baseline_web, expected_web) if name in row}
               for name in expected_web}
    copy_partial_tree(web, RELEASE / 'web', allowed)
    for name in (name for name in manifest['files'] if name.startswith('web/')):
        target = RELEASE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        copy_atomic(PACKAGE / name, target)
    for directory, _, _ in os.walk(RELEASE):
        Path(directory).chmod(0o755)
    require(inventory(RELEASE / 'web', 'web/') == expected_web, 'UPDATE_MERGED_WEB_MISMATCH')
    phase('building')
    existing_base = run(['docker', 'image', 'ls', '--quiet', '--no-trunc', BASE_ALIAS]).strip()
    require(not existing_base or existing_base == containers['api']['Image'], 'UPDATE_BASE_IMAGE_CHANGED')
    existing_candidate = run(['docker', 'image', 'ls', '--quiet', '--no-trunc', IMAGE]).strip()
    require(not existing_candidate or plan['buildStarted'], 'UPDATE_TARGET_IMAGE_EXISTS')
    plan['buildStarted'] = True
    save('plan.json', plan)
    run(['docker', 'tag', containers['api']['Image'], BASE_ALIAS])
    require(image_id(BASE_ALIAS) == containers['api']['Image'], 'UPDATE_BASE_IMAGE_CHANGED')
    run(['docker', 'build', '--pull=false', '--network=none', '--build-arg', 'BASE_IMAGE=' + BASE_ALIAS,
         '-t', IMAGE, str(RELEASE / 'package')], 600)
    phase('saving_recovery')
    candidate = image_id(IMAGE)
    require(source_hashes(candidate) == {name: manifest['files'][name] for name in UPDATE_SOURCE}, 'UPDATE_CANDIDATE_SOURCE_MISMATCH')
    recovery = {'release': PREFIX, 'services': {}, 'originalIds': {}, 'rollbackImages': {}, 'originalRunning': {},
                'baselineName': baseline_name, 'baselineSourceFiles': BASELINE_SOURCES[baseline_name],
                'baselineWebRoot': str(web), 'baselineWebFiles': baseline_web,
                'targetWebFiles': expected_web, 'caddyPath': str(caddyfile), 'caddySha256': digest(caddyfile.read_bytes()),
                'packageManifestSha256': digest((RELEASE / 'package/manifest.json').read_bytes())}
    for service in ('api', 'caddy'):
        old, new = copy.deepcopy(configs[service]), copy.deepcopy(configs[service])
        old['services'][service]['image'] = containers[service]['Image']
        new['services'][service]['image'] = candidate if service == 'api' else containers[service]['Image']
        predicted = copy.deepcopy(containers[service])
        if service == 'api':
            add_target_configuration(new['services'][service], predicted)
        else:
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
        recovery['originalRunning'][service] = containers[service]['State']['Running']
        recovery['rollbackImages'][service] = containers[service]['Image']
    recovery['configHashes'] = {name: digest((STATE / name).read_bytes()) for name in CONFIG_FILES}
    save('recovery.json', recovery)
    save('report.json', {'status': 'prepared', 'release': PREFIX})
    schema_probe()
    print('EXERCISE_VIDEO_CATEGORIES_PREPARED_LIVE_STATE_UNCHANGED', flush=True)


SCHEMA_COLUMNS = {'video_category', 'equipment_ids_json'}


def schema_probe(password=None):
    phase('schema_apply' if password is not None else 'schema_check')
    args = compose(below_base(STATE / 'api.json'), 'run', '--rm', '--no-deps', '--pull', 'never', '-T',
                   '--entrypoint', 'node', 'api', 'scripts/migrate-exercise-video-metadata.js',
                   '--apply' if password is not None else '--check-only')
    data = json.dumps({'password': password}) if password is not None else None
    value = json.loads(run(args, timeout=90, data=data))
    missing = value.get('missingColumns')
    require(set(value) == {'status', 'missingColumns'} and value.get('status') in ('ready', 'missing')
            and isinstance(missing, list) and all(isinstance(name, str) for name in missing)
            and len(missing) == len(set(missing)) and set(missing) <= SCHEMA_COLUMNS
            and (value['status'] == 'ready') == (len(missing) == 0), 'UPDATE_SCHEMA_RESPONSE_INVALID')
    print('EXERCISE_VIDEO_SCHEMA=' + value['status'].upper(), flush=True)
    return value


def schema_guard():
    require(schema_probe()['status'] == 'ready', 'UPDATE_SCHEMA_MIGRATION_REQUIRED')


def migrate():
    phase('migration_guard')
    recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
    current, manifest = recovery_guard(recovery)
    candidate = recovery['services']['api'][2]['imageId']
    require(source_hashes(candidate) == {name: manifest['files'][name] for name in UPDATE_SOURCE},
            'UPDATE_CANDIDATE_SOURCE_MISMATCH')
    if schema_probe()['status'] == 'ready':
        print('EXERCISE_VIDEO_MIGRATION=ALREADY_READY', flush=True)
        return
    password = None
    try:
        password = getpass.getpass('RDS password for outdoor_fit_migrator: ')
        require(isinstance(password, str) and password and not any(c in password for c in '\0\r\n'),
                'UPDATE_MIGRATOR_PASSWORD_INVALID')
        require(schema_probe(password)['status'] == 'ready', 'UPDATE_SCHEMA_MIGRATION_INCOMPLETE')
    finally:
        password = None
    # Verify through the application's DML account, not only the elevated account.
    schema_guard()
    recovery_guard(recovery)
    save('schema-report.json', {'release': PREFIX, 'status': 'ready', 'existingTableCountUnchanged': True,
                                'rollbackRetainsMetadataColumnsAndData': True})
    print('EXERCISE_VIDEO_MIGRATION=PASS', flush=True)


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
    require(recovery.get('targetWebFiles') == {**baseline['webFiles'], **manifest['webFiles']},
            'UPDATE_RECOVERY_TARGET_CHANGED')
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


def up(service, rollback=False, start=True):
    config = STATE / (('rollback-' if rollback else '') + service + '.json')
    run(compose(config, 'up', *(['-d'] if start else ['--no-start']), '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service))


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


def provider_smoke():
    # Read-only SQL/config probe. No key read, model request, migration or write.
    code = r"""import fs from 'node:fs';import mysql from 'mysql2/promise';
import {readMysqlConfig} from './src/mysqlConfig.js';
import {assistantProviderRuntime} from './src/assistantProviders.js';
import {publicAiConfiguration} from './src/assistantProviderRoutes.js';
let connection;const deadline=setTimeout(()=>process.exit(2),15000);
try{connection=await mysql.createConnection(readMysqlConfig({...process.env,MYSQL_PASSWORD:fs.readFileSync(process.env.MYSQL_PASSWORD_FILE,'utf8')}));
const [rows]=await connection.query({sql:"SELECT provider,model,base_url,api_key,updated_at FROM ai_configuration WHERE id='default'",timeout:8000});
if(rows.length!==1||process.env.ASSISTANT_PROVIDER_MODE!=='deepseek_only')throw Error();
const row=rows[0],runtime=assistantProviderRuntime(row),profile=publicAiConfiguration(row);
if(runtime.provider!=='deepseek'||runtime.protocol!==2||runtime.promptMode!=='app'||!runtime.faqEnabled||profile.activeProvider!=='deepseek')throw Error();
console.log(JSON.stringify({provider:runtime.provider,protocol:runtime.protocol,mode:process.env.ASSISTANT_PROVIDER_MODE}));
}catch{process.exitCode=1;}finally{if(connection)await connection.end();clearTimeout(deadline);}"""
    result = json.loads(run(['docker', 'exec', '-w', '/app', CONTAINERS['api'], 'node', '--input-type=module', '-e', code], 20))
    require(result == {'provider': 'deepseek', 'protocol': 2, 'mode': 'deepseek_only'}, 'UPDATE_PROVIDER_SMOKE_FAILED')


def verify_https(web_root):
    expected = (web_root / 'index.html').read_bytes()
    for domain, route in [('app.outdoorfit.hk', '/'), ('admin.outdoorfit.hk', '/admin')]:
        body = run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--retry', '3',
                    '--resolve', domain + ':443:127.0.0.1', 'https://' + domain + route], 75)
        require(body.encode() == expected, 'UPDATE_HTTPS_WEB_MISMATCH')
    response = json.loads(run(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--retry', '3',
                              '--resolve', 'api.outdoorfit.hk:443:127.0.0.1', 'https://api.outdoorfit.hk/api/health'], 75))
    require(response.get('ok') is True, 'UPDATE_HTTPS_API_UNHEALTHY')


def is_target(container, expected):
    return container is not None and stamp(container) == expected


def rollback(recovery, services=('api', 'caddy')):
    phase('rollback_guard')
    current, _ = recovery_guard(recovery)
    needs_api = 'api' in services and (not (current['api'] and stamp(current['api']) in recovery['services']['api'][:2])
                or current['api']['State']['Running'] and not recovery['originalRunning']['api'])
    ingress_was_running = bool(current['caddy'] and current['caddy']['State']['Running'])
    if needs_api:
        if ingress_was_running:
            run(['docker', 'stop', '--time', '90', CONTAINERS['caddy']], 110)
        try:
            no_pending_jobs()
        except BaseException as error:
            save('report.json', {'status': 'rollback_blocked', 'release': PREFIX, 'error': error_details(error)})
            if ingress_was_running:
                run(['docker', 'start', CONTAINERS['caddy']])
            raise RuntimeError('UPDATE_ROLLBACK_WAITING_FOR_AI') from None
    for service in services:
        phase('rollback_' + service)
        current, _ = recovery_guard(recovery)
        container = current[service]
        running = recovery['originalRunning'][service]
        if container and stamp(container) in recovery['services'][service][:2]:
            if container['State']['Running'] != running:
                run(['docker', 'start' if running else 'stop', CONTAINERS[service]])
        else:
            up(service, rollback=True, start=running)
        if service == 'api' and running:
            health()
    current, _ = recovery_guard(recovery)
    require(all(current[name] and stamp(current[name]) in recovery['services'][name][:2]
                and current[name]['State']['Running'] == recovery['originalRunning'][name] for name in services), 'UPDATE_ROLLBACK_INCOMPLETE_REVIEW_STATE')
    if all(recovery['originalRunning'].values()):
        phase('rollback_https')
        verify_https(Path(recovery['baselineWebRoot']))
    save('report.json', {'status': 'rolled_back', 'release': PREFIX, 'restoredRunning': recovery['originalRunning']})


def manual_rollback(recovery):
    try:
        rollback(recovery)
    except BaseException as error:
        previous = json.loads((STATE / 'report.json').read_text(encoding='utf-8'))
        save('report.json', {**previous, 'status': 'rollback_blocked' if previous.get('status') == 'rollback_blocked' else 'rollback_failed',
                            'rollbackError': error_details(error)})
        raise


def apply():
    phase('activation_guard')
    recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
    status = json.loads(below_base(STATE / 'report.json').read_text(encoding='utf-8'))
    require(status.get('status') in ('prepared', 'activating', 'complete', 'rolled_back', 'activation_failed', 'rollback_failed', 'rollback_blocked'), 'UPDATE_NOT_PREPARED_REVIEW_STATE')
    current, manifest = recovery_guard(recovery)
    target_api = is_target(current['api'], recovery['services']['api'][2])
    expected_sources = {name: manifest['files'][name] for name in UPDATE_SOURCE}
    if current['api']:
        require(source_hashes() == (expected_sources if target_api else recovery['baselineSourceFiles']), 'UPDATE_SOURCE_BASELINE_MISMATCH')
    schema_guard()
    needs_api = not target_api or not current['api']['State']['Running']
    if needs_api:
        no_pending_jobs()
    ingress_was_running = bool(current['caddy'] and current['caddy']['State']['Running'])
    touched = False
    save('report.json', {'status': 'activating', 'release': PREFIX})
    try:
        if needs_api:
            phase('draining')
            if ingress_was_running:
                run(['docker', 'stop', '--time', '90', CONTAINERS['caddy']], 110)
            try:
                no_pending_jobs()
            except BaseException:
                if ingress_was_running:
                    run(['docker', 'start', CONTAINERS['caddy']])
                save('report.json', {'status': status['status'], 'release': PREFIX})
                raise
            touched = True
            phase('activating_api')
            up('api')
        phase('health')
        health()
        require(source_hashes() == expected_sources, 'UPDATE_RUNNING_SOURCE_MISMATCH')
        provider_smoke()
        phase('activating_web')
        current, _ = recovery_guard(recovery)
        if not is_target(current['caddy'], recovery['services']['caddy'][2]) or not current['caddy']['State']['Running']:
            touched = True
            up('caddy')
        recovery_guard(recovery)
        phase('https')
        verify_https(RELEASE / 'web')
        save('report.json', {'status': 'complete', 'release': PREFIX, 'fromBaseline': recovery['baselineName'],
                             'providerSelection': 'deepseek_only', 'existingSecrets': 'unchanged',
                             'web': str(RELEASE / 'web'), 'liveAiLoadTest': 'not_performed_by_installer'})
        print('EXERCISE_VIDEO_CATEGORIES_UPDATE=PASS', flush=True)
    except BaseException as error:
        failure = error_details(error)
        if touched:
            try:
                rollback(recovery)
            except BaseException as rollback_error:
                previous = json.loads((STATE / 'report.json').read_text(encoding='utf-8'))
                save('report.json', {'status': 'rollback_blocked' if previous.get('status') == 'rollback_blocked' else 'rollback_failed',
                                    'release': PREFIX, 'activationError': failure, 'rollbackError': error_details(rollback_error)})
                print('UPDATE_RECOVERY=RETRY_APPLY_OR_ROLLBACK', flush=True)
                raise rollback_error from None
            print('EXERCISE_VIDEO_CATEGORIES_ACTIVATION_FAILED_ORIGINAL_STATE_RESTORED', flush=True)
            previous = json.loads((STATE / 'report.json').read_text(encoding='utf-8'))
            save('report.json', {**previous, 'activationError': failure})
        raise


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0 and BASE.is_dir() and BASE.resolve() == BASE and not BASE.is_symlink(),
            'UPDATE_ROOT_AND_PRODUCTION_BASE_REQUIRED')
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    for option in ('check-only', 'prepare', 'migrate', 'apply', 'rollback'):
        group.add_argument('--' + option, action='store_true')
    args = parser.parse_args()
    lock_path = BASE / '.account-data.lock'
    require(not lock_path.is_symlink(), 'UPDATE_LOCK_LINK_REFUSED')
    with lock_path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.check_only or args.prepare:
            prepare(check_only=args.check_only)
        elif args.migrate:
            migrate()
        elif args.apply:
            apply()
        else:
            recovery = json.loads(below_base(STATE / 'recovery.json').read_text(encoding='utf-8'))
            manual_rollback(recovery)
            print('EXERCISE_VIDEO_CATEGORIES_ROLLBACK_OK', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = error_details(error)['code']
        print(code, file=sys.stderr)
        print('UPDATE_ERROR_DETAILS=' + json.dumps(error_details(error), sort_keys=True), file=sys.stderr)
        sys.exit(1)
