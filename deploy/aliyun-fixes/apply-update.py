#!/usr/bin/env python3
"""Stage, activate, or roll back the reviewed v2 code/Web update on Aliyun.

No database or media migration is performed. All diagnostics are fixed codes;
Compose output and configuration values are never printed or stored in reports.
"""

import argparse
import fcntl
import hashlib
from html.parser import HTMLParser
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote, urlsplit


BASE = Path('/opt/outdoor-fit/production')
OLD_TAG, NEW_TAG = '20260924-v1', '20260924-v2'
OLD = BASE / 'releases' / ('outdoor-fit-production-' + OLD_TAG)
NEW = BASE / 'releases' / ('outdoor-fit-production-' + NEW_TAG)
ENV = BASE / 'secrets/production.env'
STATE = BASE / '.update-state' / NEW_TAG
REPORT = STATE / 'report.json'
OLD_ENV, CANDIDATE_ENV = STATE / 'old.env', STATE / 'candidate.env'
BASELINE_SHA = '3200ba265dc6a2f14838fa397cf73fdcf5dad7f0d3e08224affa9240a836a9a8'
PRESERVE = {'deploy/aliyun-production/Caddyfile', 'deploy/aliyun-production/compose.yaml'}
SUPPORT = {'apply-update.py', 'Dockerfile', 'Dockerfile.dockerignore', 'README.md', 'check-aliyun-research-sql.js'}
SERVER_DELTA = {'server/src/appMysql.js', 'server/src/mysqlResearchSql.js'}
MAX_FILE = 512 * 1024 * 1024


class UpdateError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise UpdateError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def signature(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def safe_name(name):
    require(isinstance(name, str) and name and not any(c in name for c in ('\\', '\0', '\r', '\n')),
            'UPDATE_MANIFEST_PATH_INVALID')
    parts = PurePosixPath(name).parts
    require(parts and not name.startswith('/') and '..' not in parts and str(PurePosixPath(name)) == name,
            'UPDATE_MANIFEST_PATH_INVALID')
    for part in parts:
        lower = part.lower()
        require(not lower.startswith('.env') and lower not in {'.git', 'secrets', 'credentials', 'id_rsa', 'id_ed25519'}
                and not lower.endswith(('.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite-wal', '.sqlite-shm', '.db', '.zip', '.tar.gz')),
                'UPDATE_PRIVATE_FILE_REFUSED')
    require('node_modules' not in parts or parts[:2] == ('web', 'assets'), 'UPDATE_DEPENDENCY_TREE_REFUSED')
    return name


def checked_path(path, directory=False):
    require(path.is_absolute(), 'UPDATE_ABSOLUTE_PATH_REQUIRED')
    for component in reversed((path, *path.parents)):
        info = component.lstat()
        require(not stat.S_ISLNK(info.st_mode), 'UPDATE_SYMLINK_REFUSED')
        require(stat.S_ISDIR(info.st_mode) if component != path or directory else stat.S_ISREG(info.st_mode),
                'UPDATE_PATH_TYPE_INVALID')
    info = path.lstat()
    if not directory:
        require(info.st_nlink == 1, 'UPDATE_HARDLINK_REFUSED')
    return info


def read_file(path, private=False, maximum=MAX_FILE):
    before = checked_path(path)
    require(0 <= before.st_size <= maximum, 'UPDATE_FILE_SIZE_INVALID')
    if private:
        require(before.st_uid == 1000 and before.st_gid == 1000 and stat.S_IMODE(before.st_mode) == 0o400,
                'UPDATE_ENV_PERMISSIONS_INVALID')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(descriptor, 'rb') as source:
        require(signature(os.fstat(source.fileno())) == signature(before), 'UPDATE_FILE_CHANGED')
        data = source.read(maximum + 1)
        require(len(data) == before.st_size and signature(os.fstat(source.fileno())) == signature(before)
                and signature(path.lstat()) == signature(before), 'UPDATE_FILE_CHANGED')
    return data


def metadata(data, mode=0o644):
    return {'sha256': digest(data), 'size': len(data), 'mode': mode}


def match_file(path, record):
    data = read_file(path)
    require(len(data) == record['size'] and digest(data) == record['sha256'], 'UPDATE_FILE_HASH_MISMATCH')
    return data


def validate_records(records):
    require(isinstance(records, dict) and 0 < len(records) <= 4096, 'UPDATE_MANIFEST_RECORDS_INVALID')
    for name, record in records.items():
        safe_name(name)
        require(isinstance(record, dict) and set(record) == {'sha256', 'size', 'mode'}
                and isinstance(record['sha256'], str) and re.fullmatch('[0-9a-f]{64}', record['sha256'])
                and type(record['size']) is int and 0 <= record['size'] <= MAX_FILE
                and type(record['mode']) is int and record['mode'] in (0o644, 0o755),
                'UPDATE_MANIFEST_RECORD_INVALID')


def load_package(package):
    checked_path(package, directory=True)
    raw = read_file(package / 'release-manifest.json', maximum=4 * 1024 * 1024)
    manifest = json.loads(raw)
    require(manifest.get('formatVersion') == 1 and manifest.get('releaseTag') == NEW_TAG
            and manifest.get('baselineTag') == OLD_TAG and manifest.get('baselineArchiveSha256') == BASELINE_SHA,
            'UPDATE_MANIFEST_VERSION_INVALID')
    for key in ('baselineFiles', 'deltaFiles', 'supportFiles', 'currentWebFiles'):
        validate_records(manifest.get(key))
    baseline, delta = manifest['baselineFiles'], manifest['deltaFiles']
    require(len(baseline) == 318 and sum(name.startswith('server/') for name in baseline) == 62
            and sum(name.startswith('web/') for name in baseline) == 246,
            'UPDATE_BASELINE_FILE_COUNT_INVALID')
    require(all(name.startswith(('server/', 'web/', 'deploy/aliyun-production/')) for name in baseline),
            'UPDATE_BASELINE_SCOPE_INVALID')
    require(set(manifest.get('preserveLive', [])) == PRESERVE and PRESERVE <= baseline.keys()
            and set(manifest['supportFiles']) == SUPPORT, 'UPDATE_MANIFEST_SUPPORT_INVALID')
    require({name for name in delta if name.startswith('server/')} == SERVER_DELTA
            and all(name.startswith('web/') or name in SERVER_DELTA for name in delta)
            and 'web/index.html' in delta, 'UPDATE_DELTA_SCOPE_INVALID')
    candidate = dict(baseline, **delta)
    require('web/index.html' in manifest['currentWebFiles'] and all(name.startswith('web/') and candidate.get(name) == record
            for name, record in manifest['currentWebFiles'].items()), 'UPDATE_WEB_MANIFEST_INVALID')
    for name, record in manifest['supportFiles'].items():
        match_file(package / name, record)
    for name, record in delta.items():
        match_file(package / 'payload' / name, record)
    return manifest, digest(raw)


def env_keys(data):
    require(b'\0' not in data, 'UPDATE_ENV_INVALID')
    keys = set()
    for line in data.decode('utf-8').splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, _ = line.partition('=')
        require(separator and re.fullmatch('[A-Z][A-Z0-9_]*', key) and key not in keys, 'UPDATE_ENV_INVALID')
        keys.add(key)
    return keys


def candidate_environment(data):
    env_keys(data)
    replacing = {
        b'RELEASE_TAG=' + OLD_TAG.encode(): b'RELEASE_TAG=' + NEW_TAG.encode(),
        b'ADMIN_WEB_DIR=' + str(OLD / 'web').encode(): b'ADMIN_WEB_DIR=' + str(NEW / 'web').encode(),
    }
    seen, lines = set(), []
    for line in data.splitlines(keepends=True):
        content = line.rstrip(b'\r\n')
        if content in replacing:
            require(content not in seen, 'UPDATE_ENV_TARGET_DUPLICATED')
            seen.add(content)
            line = replacing[content] + line[len(content):]
        lines.append(line)
    require(seen == replacing.keys(), 'UPDATE_ENV_BASELINE_MISMATCH')
    return b''.join(lines)


def command_env(environment):
    values = dict(os.environ)
    for key in list(values):
        if key in env_keys(environment) or key.startswith('COMPOSE_'):
            del values[key]
    # This updater is strictly for the local ECS Docker daemon.
    values.pop('DOCKER_CONTEXT', None)
    values['DOCKER_HOST'] = 'unix:///var/run/docker.sock'
    return values


def command(args, environment, timeout=30, stdin=None, check=True):
    try:
        result = subprocess.run(args, input=stdin, capture_output=True, env=command_env(environment), timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise UpdateError('UPDATE_COMMAND_UNAVAILABLE_OR_TIMEOUT') from None
    if check:
        require(result.returncode == 0, 'UPDATE_COMMAND_FAILED')
    return result


def image_id(tag, environment):
    result = command(['docker', 'image', 'inspect', 'outdoor-fit-api:' + tag, '--format', '{{.Id}}'], environment)
    value = result.stdout.decode('ascii').strip()
    require(re.fullmatch('sha256:[0-9a-f]{64}', value), 'UPDATE_IMAGE_ID_INVALID')
    return value


def api_identity(environment, missing=False):
    result = command(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=outdoor-fit-production',
                      '--filter', 'label=com.docker.compose.service=api', '--filter', 'status=running'], environment)
    identifiers = result.stdout.decode('ascii').split()
    if missing and not identifiers:
        return None
    require(len(identifiers) == 1 and re.fullmatch('[0-9a-f]{12,64}', identifiers[0]), 'UPDATE_RUNNING_API_AMBIGUOUS')
    info = json.loads(command(['docker', 'inspect', identifiers[0]], environment).stdout)[0]
    require(info['State']['Running'] is True, 'UPDATE_API_NOT_RUNNING')
    return {'tag': info['Config']['Image'], 'id': info['Image']}


def require_api(tag, expected_id, environment):
    require(api_identity(environment) == {'tag': 'outdoor-fit-api:' + tag, 'id': expected_id}
            and image_id(tag, environment) == expected_id, 'UPDATE_RUNNING_API_IMAGE_MISMATCH')


def compose(root, env_file, arguments, timeout=60, stdin=None, check=True):
    environment = read_file(env_file, private=True, maximum=65536)
    return command(['docker', 'compose', '--project-name', 'outdoor-fit-production',
                    '--env-file', str(env_file),
                    '-f', str(root / 'deploy/aliyun-production/compose.yaml'), *arguments],
                   environment, timeout=timeout, stdin=stdin, check=check)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def exclusive_file(path, data, mode=0o644, owner=0):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)
        output.flush()
        os.fchown(output.fileno(), owner, owner)
        os.fchmod(output.fileno(), mode)
        os.fsync(output.fileno())


def private_directory(path, create=False):
    if create and not os.path.lexists(path):
        path.mkdir(mode=0o700)
    info = checked_path(path, directory=True)
    require(info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o700,
            'UPDATE_STATE_PERMISSIONS_INVALID')


def write_report(report, phase):
    report['phase'] = phase
    data = (json.dumps(report, sort_keys=True, indent=2) + '\n').encode('utf-8')
    descriptor, name = tempfile.mkstemp(prefix='.report-', dir=STATE)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)
        output.flush()
        os.fchmod(output.fileno(), 0o600)
        os.fsync(output.fileno())
    if os.path.lexists(REPORT):
        info = checked_path(REPORT)
        require(info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600, 'UPDATE_REPORT_PERMISSIONS_INVALID')
    os.replace(name, REPORT)
    sync_directory(STATE)
    print('UPDATE_PHASE=' + phase, flush=True)


def baseline_inventory(manifest):
    checked_path(OLD, directory=True)
    records = {}
    for name, record in manifest['baselineFiles'].items():
        path = OLD / name
        if name in PRESERVE:
            data = read_file(path)
            records[name] = metadata(data, 0o644)
        else:
            match_file(path, record)
            records[name] = record
    return records


def verify_files(root, records):
    for name, record in records.items():
        match_file(root / safe_name(name), record)


def candidate_parents(relative):
    # mkdir's mode is filtered through private umask 077. Explicitly expose
    # only these newly created release directories so UID 1000 can read Web.
    current = NEW
    for part in PurePosixPath(relative).parent.parts:
        current = current / part
        if not os.path.lexists(current):
            current.mkdir(mode=0o700)
            os.chmod(current, 0o755)
        else:
            checked_path(current, directory=True)


def verify_candidate(records):
    verify_files(NEW, records)
    actual = set()
    for parent, directories, files in os.walk(NEW, followlinks=False):
        for name in directories:
            path = Path(parent) / name
            info = checked_path(path, directory=True)
            require(stat.S_IMODE(info.st_mode) & 0o005 == 0o005, 'UPDATE_CANDIDATE_DIRECTORY_UNREADABLE')
        for name in files:
            path = Path(parent) / name
            info = checked_path(path)
            require(stat.S_IMODE(info.st_mode) & 0o004, 'UPDATE_CANDIDATE_FILE_UNREADABLE')
            actual.add(path.relative_to(NEW).as_posix())
    require(actual == set(records), 'UPDATE_CANDIDATE_FILES_CHANGED')


def candidate_tag_absent(environment):
    existing = command(['docker', 'image', 'ls', '--quiet', '--no-trunc', 'outdoor-fit-api:' + NEW_TAG], environment)
    require(not existing.stdout.strip(), 'UPDATE_CANDIDATE_IMAGE_ALREADY_EXISTS')


def replace_environment(data, expected_hash):
    current = read_file(ENV, private=True, maximum=65536)
    require(digest(current) == expected_hash, 'UPDATE_LIVE_ENV_CHANGED')
    descriptor, name = tempfile.mkstemp(prefix='.production-env-', dir=ENV.parent)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)
        output.flush()
        os.fchown(output.fileno(), 1000, 1000)
        os.fchmod(output.fileno(), 0o400)
        os.fsync(output.fileno())
    require(digest(read_file(ENV, private=True, maximum=65536)) == expected_hash, 'UPDATE_LIVE_ENV_CHANGED')
    os.replace(name, ENV)
    sync_directory(ENV.parent)


def up(root):
    compose(root, ENV, ['up', '-d', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180'], timeout=360)


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attributes):
        if tag.lower() == 'script':
            self.sources.extend(value for name, value in attributes if name.lower() == 'src' and value)


def https_body(host, path, maximum, deadline):
    # Standard HTTPSConnection verifies certificate/hostname and does not honor
    # shell HTTP proxy variables. No credential or authenticated URL is used.
    require(time.monotonic() < deadline, 'UPDATE_HTTPS_DEADLINE')
    connection = http.client.HTTPSConnection(host, timeout=min(8, max(0.5, deadline - time.monotonic())))
    try:
        connection.request('GET', path, headers={'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache'})
        response = connection.getresponse()
        require(response.status == 200 and response.getheader('Content-Encoding', 'identity') in ('', 'identity'),
                'UPDATE_HTTPS_RESPONSE_INVALID')
        data = bytearray()
        while True:
            require(time.monotonic() < deadline, 'UPDATE_HTTPS_DEADLINE')
            block = response.read(min(65536, maximum + 1 - len(data)))
            if not block:
                return bytes(data)
            data.extend(block)
            require(len(data) <= maximum, 'UPDATE_HTTPS_RESPONSE_TOO_LARGE')
    finally:
        connection.close()


def verify_https(root, records, tag):
    index = match_file(root / 'web/index.html', records['web/index.html'])
    parser = Scripts()
    parser.feed(index.decode('utf-8'))
    scripts = []
    for value in parser.sources:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or not parsed.path.startswith('/'):
            continue
        relative = 'web/' + unquote(parsed.path.lstrip('/'))
        if relative in records and relative.endswith('.js'):
            scripts.append((records[relative]['size'], parsed.path, records[relative]))
    require(scripts, 'UPDATE_WEB_ENTRY_SCRIPT_MISSING')
    _, asset_path, asset = max(scripts, key=lambda entry: entry[0])
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        try:
            health = json.loads(https_body('api.outdoorfit.hk', '/api/health', 65536, deadline))
            require(health.get('ok') is True, 'UPDATE_API_HTTPS_HEALTH_FAILED')
            html = https_body('admin.outdoorfit.hk', '/index.html?release=' + tag, len(index), deadline)
            require(digest(html) == records['web/index.html']['sha256'], 'UPDATE_ADMIN_HTML_HASH_MISMATCH')
            data = https_body('admin.outdoorfit.hk', asset_path + '?release=' + tag, asset['size'], deadline)
            require(len(data) == asset['size'] and digest(data) == asset['sha256'], 'UPDATE_ADMIN_ASSET_HASH_MISMATCH')
            print('UPDATE_HTTPS_HEALTH_AND_WEB=PASS', flush=True)
            return
        except (UpdateError, OSError, ValueError, http.client.HTTPException):
            if time.monotonic() < deadline:
                time.sleep(min(2, deadline - time.monotonic()))
    raise UpdateError('UPDATE_HTTPS_HEALTH_OR_WEB_FAILED')


def research_diagnostics(stdout):
    allowed_stages = {'configuration', 'connection', 'session', 'json_values', 'binary_comparisons',
                      'count_aggregate', 'video_aggregate', 'screen_options'}
    allowed_codes = {
        'RESEARCH_SECRET_FILE_REQUIRED', 'RESEARCH_SECRET_FILE_INVALID', 'RESEARCH_PRODUCTION_ACCOUNT_REQUIRED',
        'RESEARCH_TLS_IDENTITY_REQUIRED', 'RESEARCH_JSON_DRIVER_CONFIGURATION_REQUIRED', 'RESEARCH_TLS_NOT_VERIFIED',
        'RESEARCH_PRODUCTION_ACCOUNT_MISMATCH', 'RESEARCH_SESSION_MISMATCH', 'RESEARCH_JSON_ROW_COUNT_MISMATCH',
        'RESEARCH_JSON_VALUE_MISMATCH', 'RESEARCH_JSON_COLLATION_MISMATCH', 'RESEARCH_BINARY_COMPARISON_MISMATCH',
        'RESEARCH_COUNT_AGGREGATE_MISMATCH', 'RESEARCH_VIDEO_AGGREGATE_MISMATCH', 'RESEARCH_SCREEN_OPTIONS_MISMATCH',
        'RESEARCH_SQL_CHECK_FAILED', 'RESEARCH_CONNECTION_CLOSE_FAILED', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR',
        'ER_BAD_DB_ERROR', 'ER_PARSE_ERROR', 'ER_WRONG_FIELD_WITH_GROUP', 'ER_COLLATION_CHARSET_MISMATCH',
        'ER_CANT_AGGREGATE_2COLLATIONS', 'ER_CANT_AGGREGATE_3COLLATIONS', 'ER_CANT_AGGREGATE_NCOLLATIONS',
        'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_TLS_CERT_ALTNAME_INVALID',
        'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'HANDSHAKE_NO_SSL_SUPPORT',
    }
    result = {}
    for line in stdout.decode('utf-8', errors='replace').splitlines():
        key, _, value = line.partition('=')
        if key == 'ERROR_CODE' and value in allowed_codes:
            result['probeErrorCode'] = value
            print('PROBE_ERROR_CODE=' + value, flush=True)
        elif key == 'ERROR_STAGE' and value in allowed_stages:
            result['probeErrorStage'] = value
            print('PROBE_ERROR_STAGE=' + value, flush=True)
    return result


def stage(package, manifest, manifest_sha):
    require(not os.path.lexists(NEW) and not os.path.lexists(STATE), 'UPDATE_STAGE_ALREADY_EXISTS')
    old_env = read_file(ENV, private=True, maximum=65536)
    new_env = candidate_environment(old_env)
    old_image = image_id(OLD_TAG, old_env)
    require_api(OLD_TAG, old_image, old_env)
    candidate_tag_absent(old_env)
    baseline = baseline_inventory(manifest)
    STATE.mkdir(mode=0o700)
    report = {'formatVersion': 1, 'releaseTag': NEW_TAG, 'manifestSha256': manifest_sha,
              'oldEnvSha256': digest(old_env), 'candidateEnvSha256': digest(new_env),
              'oldImageId': old_image, 'oldFiles': baseline, 'newFiles': {}}
    exclusive_file(OLD_ENV, old_env, mode=0o400, owner=1000)
    exclusive_file(CANDIDATE_ENV, new_env, mode=0o400, owner=1000)
    write_report(report, 'staging')
    NEW.mkdir(mode=0o700)
    records = dict(baseline, **manifest['deltaFiles'])
    support = {'deploy/aliyun-fixes/' + name: manifest['supportFiles'][name]
               for name in ('Dockerfile', 'Dockerfile.dockerignore')}
    records.update(support)
    for name, record in records.items():
        destination = NEW / name
        candidate_parents(name)
        if name in support:
            source = package / Path(name).name
        elif name in manifest['deltaFiles']:
            source = package / 'payload' / name
        else:
            source = OLD / name
        exclusive_file(destination, match_file(source, record), mode=record['mode'])
    report['newFiles'] = records
    verify_files(OLD, baseline)
    verify_candidate(records)
    require(digest(read_file(ENV, private=True)) == report['oldEnvSha256'], 'UPDATE_LIVE_ENV_CHANGED')
    require_api(OLD_TAG, old_image, old_env)
    candidate_tag_absent(old_env)
    write_report(report, 'building')
    command(['docker', 'build', '--pull=false', '--network=none', '-f', str(NEW / 'deploy/aliyun-fixes/Dockerfile'),
             '-t', 'outdoor-fit-api:' + NEW_TAG, str(NEW)], new_env, timeout=600)
    report['newImageId'] = image_id(NEW_TAG, new_env)
    require_api(OLD_TAG, old_image, old_env)
    write_report(report, 'validating_config')
    compose(NEW, CANDIDATE_ENV, ['config', '--quiet'])
    write_report(report, 'validating_caddy')
    compose(NEW, CANDIDATE_ENV, ['run', '--rm', '--no-deps', '-T', '--pull', 'never', '--entrypoint', 'caddy',
                               'caddy', 'validate', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], timeout=90)
    write_report(report, 'validating_web_mount')
    mounted = compose(NEW, CANDIDATE_ENV, ['run', '--rm', '--no-deps', '-T', '--pull', 'never', '--entrypoint', 'sh',
                                         'caddy', '-c', 'sha256sum /srv/admin/index.html'], timeout=60)
    require(mounted.stdout.split() and mounted.stdout.split()[0].decode('ascii') == records['web/index.html']['sha256'],
            'UPDATE_CANDIDATE_WEB_MOUNT_MISMATCH')
    write_report(report, 'validating_research_sql')
    probe = match_file(package / 'check-aliyun-research-sql.js', manifest['supportFiles']['check-aliyun-research-sql.js'])
    result = compose(NEW, CANDIDATE_ENV, ['run', '--rm', '--no-deps', '-T', '--pull', 'never', '--entrypoint', 'node',
                                         'api', '--input-type=module'], timeout=90, stdin=probe, check=False)
    if result.returncode != 0 or b'RESEARCH_SQL_COMPATIBILITY=PASS' not in result.stdout.splitlines():
        report.update(research_diagnostics(result.stdout))
        write_report(report, 'validating_research_sql')
        raise UpdateError('UPDATE_RESEARCH_SQL_CHECK_FAILED')
    print('RESEARCH_SQL_COMPATIBILITY=PASS', flush=True)
    verify_files(OLD, baseline)
    verify_candidate(records)
    require(digest(read_file(ENV, private=True)) == report['oldEnvSha256'], 'UPDATE_LIVE_ENV_CHANGED')
    require_api(OLD_TAG, old_image, old_env)
    require(image_id(NEW_TAG, new_env) == report['newImageId'], 'UPDATE_CANDIDATE_IMAGE_CHANGED')
    write_report(report, 'staged')


def load_state(manifest, manifest_sha):
    private_directory(STATE)
    info = checked_path(REPORT)
    require(info.st_uid == 0 and info.st_gid == 0 and stat.S_IMODE(info.st_mode) == 0o600,
            'UPDATE_REPORT_PERMISSIONS_INVALID')
    report = json.loads(read_file(REPORT, maximum=4 * 1024 * 1024))
    require(report.get('formatVersion') == 1 and report.get('releaseTag') == NEW_TAG
            and report.get('manifestSha256') == manifest_sha, 'UPDATE_STATE_PACKAGE_MISMATCH')
    old_env = read_file(OLD_ENV, private=True, maximum=65536)
    new_env = read_file(CANDIDATE_ENV, private=True, maximum=65536)
    require(digest(old_env) == report['oldEnvSha256'] and digest(new_env) == report['candidateEnvSha256']
            and candidate_environment(old_env) == new_env, 'UPDATE_STATE_ENV_MISMATCH')
    require(set(report['oldFiles']) == set(manifest['baselineFiles'])
            and all(record == manifest['baselineFiles'][name] for name, record in report['oldFiles'].items() if name not in PRESERVE),
            'UPDATE_STATE_BASELINE_MISMATCH')
    verify_files(OLD, report['oldFiles'])
    require(image_id(OLD_TAG, old_env) == report['oldImageId'], 'UPDATE_BASELINE_IMAGE_CHANGED')
    return report, old_env, new_env


def restore(report, old_env, new_env, explicit=False):
    current_env = read_file(ENV, private=True, maximum=65536)
    require(digest(current_env) in (report['oldEnvSha256'], report['candidateEnvSha256']), 'UPDATE_LIVE_ENV_CHANGED')
    verify_files(OLD, report['oldFiles'])
    if explicit:
        verify_files(NEW, {name: report['newFiles'][name] for name in PRESERVE})
    require(image_id(OLD_TAG, old_env) == report['oldImageId'], 'UPDATE_BASELINE_IMAGE_CHANGED')
    active = api_identity(current_env, missing=True)
    require(active is None or active in (
        {'tag': 'outdoor-fit-api:' + OLD_TAG, 'id': report['oldImageId']},
        {'tag': 'outdoor-fit-api:' + NEW_TAG, 'id': report['newImageId']}), 'UPDATE_UNEXPECTED_RUNNING_API')
    write_report(report, 'restoring')
    if digest(current_env) != report['oldEnvSha256']:
        replace_environment(old_env, report['candidateEnvSha256'])
    up(OLD)
    require_api(OLD_TAG, report['oldImageId'], old_env)
    verify_https(OLD, report['oldFiles'], OLD_TAG)
    require(digest(read_file(ENV, private=True)) == report['oldEnvSha256'], 'UPDATE_LIVE_ENV_CHANGED')
    write_report(report, 'rolled_back')


def activate(manifest, manifest_sha):
    report, old_env, new_env = load_state(manifest, manifest_sha)
    require(report['phase'] == 'staged', 'UPDATE_NOT_READY_FOR_ACTIVATION')
    expected = dict(report['oldFiles'], **manifest['deltaFiles'])
    expected.update({'deploy/aliyun-fixes/' + name: manifest['supportFiles'][name]
                     for name in ('Dockerfile', 'Dockerfile.dockerignore')})
    require(report['newFiles'] == expected, 'UPDATE_STATE_CANDIDATE_MISMATCH')
    verify_candidate(report['newFiles'])
    require_api(OLD_TAG, report['oldImageId'], old_env)
    require(image_id(NEW_TAG, new_env) == report['newImageId'], 'UPDATE_CANDIDATE_IMAGE_CHANGED')
    require(digest(read_file(ENV, private=True)) == report['oldEnvSha256'], 'UPDATE_LIVE_ENV_CHANGED')
    compose(NEW, CANDIDATE_ENV, ['config', '--quiet'])
    write_report(report, 'activating')
    try:
        replace_environment(new_env, report['oldEnvSha256'])
        up(NEW)
        require_api(NEW_TAG, report['newImageId'], new_env)
        verify_https(NEW, report['newFiles'], NEW_TAG)
        require(digest(read_file(ENV, private=True)) == report['candidateEnvSha256'], 'UPDATE_LIVE_ENV_CHANGED')
        write_report(report, 'activated')
    except BaseException:
        try:
            restore(report, old_env, new_env)
        except BaseException:
            write_report(report, 'restore_failed')
            raise UpdateError('UPDATE_ACTIVATION_FAILED_RESTORE_NEEDS_REVIEW') from None
        raise UpdateError('UPDATE_ACTIVATION_FAILED_BASELINE_RESTORED') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('stage', 'activate', 'rollback'))
    args = parser.parse_args()
    require(os.geteuid() == 0, 'UPDATE_REQUIRES_ROOT')
    os.umask(0o077)
    private_directory(BASE)
    checked_path(BASE / 'releases', directory=True)
    private_directory(BASE / 'secrets')
    private_directory(BASE / '.update-state', create=True)
    lock_path = BASE / '.update.lock'
    descriptor = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        info = os.fstat(descriptor)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == 0 and info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o600, 'UPDATE_LOCK_INVALID')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise UpdateError('UPDATE_ALREADY_RUNNING') from None
        package = Path(os.path.abspath(__file__)).parent
        manifest, manifest_sha = load_package(package)
        if args.action == 'stage':
            fresh = not os.path.lexists(STATE)
            try:
                stage(package, manifest, manifest_sha)
            except BaseException:
                # Record only this invocation's new state; never alter an
                # existing/unknown stage after refusing to overwrite it.
                if fresh and os.path.lexists(REPORT):
                    try:
                        report = json.loads(read_file(REPORT, maximum=4 * 1024 * 1024))
                        require(report.get('manifestSha256') == manifest_sha, 'UPDATE_STATE_PACKAGE_MISMATCH')
                        report['failedPhase'] = report['phase']
                        write_report(report, 'stage_failed')
                    except Exception:
                        pass
                raise
        elif args.action == 'activate':
            activate(manifest, manifest_sha)
        else:
            report, old_env, new_env = load_state(manifest, manifest_sha)
            require(report['phase'] in ('activated', 'activating', 'restoring', 'restore_failed'), 'UPDATE_ROLLBACK_PHASE_INVALID')
            restore(report, old_env, new_env, explicit=True)
        print('UPDATE_RESULT=PASS')
        print('REPORT_FILE=' + str(REPORT))
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    try:
        main()
    except UpdateError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('UPDATE_INTERRUPTED_REVIEW_STATE', file=sys.stderr)
        sys.exit(130)
    except Exception:
        print('UPDATE_FAILED_REVIEW_STATE', file=sys.stderr)
        sys.exit(1)
