#!/usr/bin/env python3
"""Package reviewed server/Web differences against the immutable Aliyun v1."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / 'deploy/aliyun-production/outdoor-fit-production-v1.tar.gz'
BASELINE_SHA = '3200ba265dc6a2f14838fa397cf73fdcf5dad7f0d3e08224affa9240a836a9a8'
BASELINE_PREFIX = 'outdoor-fit-production-20260924-v1'
PREFIX = 'outdoor-fit-fixes-20260924-v2'
OUT = ROOT / 'deploy/aliyun-fixes/outdoor-fit-fixes-20260924-v2.tar.gz'
PRESERVE = ['deploy/aliyun-production/Caddyfile', 'deploy/aliyun-production/compose.yaml']
SERVER_CHANGES = {'server/src/appMysql.js', 'server/src/mysqlResearchSql.js'}
SUPPORT = ['apply-update.py', 'Dockerfile', 'Dockerfile.dockerignore', 'README.md',
           'check-aliyun-research-sql.js']


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def stream_sha(stream):
    value = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(block)
    return value.hexdigest()


def safe_name(name):
    parts = PurePosixPath(name).parts
    require(parts and not name.startswith('/') and '..' not in parts and '\\' not in name
            and str(PurePosixPath(name)) == name, 'PACKAGE_PATH_INVALID')
    for part in parts:
        lower = part.lower()
        require(not lower.startswith('.env') and lower not in {'.git', 'secrets', 'credentials', 'id_rsa', 'id_ed25519'}
                and not lower.endswith(('.env', '.pem', '.key', '.p12', '.pfx', '.sqlite', '.sqlite-wal',
                                        '.sqlite-shm', '.sqlite-journal', '.db', '.db-wal', '.db-shm',
                                        '.db-journal', '.zip', '.tar.gz')), 'PACKAGE_PRIVATE_FILE_REFUSED')
    require('node_modules' not in parts or parts[:2] == ('web', 'assets'), 'PACKAGE_DEPENDENCY_TREE_REFUSED')


def safe_file(path):
    require(ROOT in path.resolve().parents, 'PACKAGE_INPUT_OUTSIDE_WORKSPACE')
    for component in (path, *path.parents):
        if component == ROOT:
            break
        info = component.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                'PACKAGE_INPUT_LINK_REFUSED')
    require(path.is_file(), 'PACKAGE_INPUT_NOT_REGULAR')
    return path


def inventory(directory, prefix):
    result = {}
    require(directory.is_dir(), 'PACKAGE_DIRECTORY_MISSING')
    for parent, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs:
            child = Path(parent) / name
            info = child.lstat()
            require(not child.is_symlink() and not (getattr(info, 'st_file_attributes', 0) & 0x400),
                    'PACKAGE_INPUT_LINK_REFUSED')
        for name in files:
            path = safe_file(Path(parent) / name)
            relative = prefix + '/' + path.relative_to(directory).as_posix()
            safe_name(relative)
            result[relative] = path
    return result


def metadata(path):
    safe_file(path)
    return {'sha256': sha(path), 'size': path.stat().st_size, 'mode': 0o644}


def read_baseline():
    require(sha(safe_file(BASELINE)) == BASELINE_SHA, 'PACKAGE_BASELINE_HASH_MISMATCH')
    result = {}
    with tarfile.open(BASELINE, 'r:gz') as archive:
        for item in archive:
            if item.isdir():
                continue
            require(item.isfile() and item.name.startswith(BASELINE_PREFIX + '/'), 'PACKAGE_BASELINE_MEMBER_INVALID')
            relative = item.name[len(BASELINE_PREFIX) + 1:]
            safe_name(relative)
            require(relative not in result, 'PACKAGE_BASELINE_DUPLICATE')
            hasher = hashlib.sha256()
            with archive.extractfile(item) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    hasher.update(block)
            result[relative] = {'sha256': hasher.hexdigest(), 'size': item.size, 'mode': item.mode & 0o777}
    require(sum(name.startswith('server/') for name in result) == 62, 'PACKAGE_BASELINE_SERVER_COUNT')
    require(sum(name.startswith('web/') for name in result) == 246, 'PACKAGE_BASELINE_WEB_COUNT')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build', action='store_true', required=True)
    parser.add_argument('--web-dir', required=True, type=Path)
    args = parser.parse_args()
    require(args.web_dir.is_absolute(), 'PACKAGE_WEB_PATH_MUST_BE_ABSOLUTE')
    baseline = read_baseline()
    sources = inventory(ROOT / 'server/src', 'server/src')
    require(all(path.endswith(('.js', '.json')) for path in sources), 'PACKAGE_SERVER_FILE_UNEXPECTED')
    for name in ('package.json', 'package-lock.json'):
        sources['server/' + name] = safe_file(ROOT / 'server' / name)
    baseline_server = {name for name in baseline if name.startswith('server/')}
    require(baseline_server <= sources.keys(), 'PACKAGE_SERVER_DELETION_REFUSED')
    require(set(sources) - baseline_server == {'server/src/mysqlResearchSql.js'}, 'PACKAGE_NEW_SERVER_FILE_UNEXPECTED')
    web = inventory(args.web_dir, 'web')
    require('web/index.html' in web, 'PACKAGE_WEB_INDEX_MISSING')
    current = dict(sources, **web)
    records = {name: metadata(path) for name, path in current.items()}
    delta = {name: record for name, record in records.items()
             if name not in baseline or record['sha256'] != baseline[name]['sha256']}
    require({name for name in delta if name.startswith('server/')} == SERVER_CHANGES,
            'PACKAGE_SERVER_CHANGE_SCOPE_MISMATCH')
    require('web/index.html' in delta, 'PACKAGE_NEW_WEB_EXPORT_REQUIRED')
    support_paths = {name: safe_file(ROOT / 'deploy/aliyun-fixes' / name)
                     for name in SUPPORT if name != 'check-aliyun-research-sql.js'}
    support_paths['check-aliyun-research-sql.js'] = safe_file(ROOT / 'server/scripts/check-aliyun-research-sql.js')
    support = {name: metadata(path) for name, path in support_paths.items()}
    manifest = {'formatVersion': 1, 'releaseTag': '20260924-v2', 'baselineTag': '20260924-v1',
                'baselineArchiveSha256': BASELINE_SHA, 'baselineFiles': baseline,
                'preserveLive': PRESERVE, 'deltaFiles': delta, 'supportFiles': support,
                'currentWebFiles': {name: records[name] for name in web}}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')
    sums = OUT.parent / 'SHA256SUMS'
    partial = OUT.with_name(OUT.name + '.partial')
    for path in (OUT, sums, partial):
        require(not os.path.lexists(path), 'PACKAGE_OUTPUT_EXISTS')
    members = {name: (path, support[name]) for name, path in support_paths.items()}
    members.update({'payload/' + name: (current[name], record) for name, record in delta.items()})
    descriptor = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        with tarfile.open(fileobj=output, mode='w:gz', format=tarfile.PAX_FORMAT, compresslevel=6) as archive:
            import io
            for name, value in [('release-manifest.json', (None, {'size': len(manifest_bytes), 'mode': 0o644}))] + sorted(members.items()):
                path, record = value
                info = tarfile.TarInfo(PREFIX + '/' + name)
                info.size, info.mode, info.mtime = record['size'], record['mode'], 0
                info.uid = info.gid = 0
                if path is None:
                    archive.addfile(info, io.BytesIO(manifest_bytes))
                else:
                    with safe_file(path).open('rb') as source:
                        archive.addfile(info, source)
        output.flush()
        os.fsync(output.fileno())
    expected = {'release-manifest.json': hashlib.sha256(manifest_bytes).hexdigest(),
                **{name: record['sha256'] for name, (_, record) in members.items()}}
    seen = set()
    with tarfile.open(partial, 'r:gz') as archive:
        for item in archive:
            require(item.isfile() and item.name.startswith(PREFIX + '/'), 'PACKAGE_MEMBER_INVALID')
            name = item.name[len(PREFIX) + 1:]
            require(name in expected and name not in seen, 'PACKAGE_MEMBER_UNEXPECTED')
            seen.add(name)
            with archive.extractfile(item) as stream:
                require(stream_sha(stream) == expected[name], 'PACKAGE_CONTENT_MISMATCH')
    require(seen == set(expected), 'PACKAGE_MEMBER_MISSING')
    require(all(metadata(path)['sha256'] == records[name]['sha256'] for name, path in current.items()),
            'PACKAGE_SOURCE_CHANGED')
    require(all(metadata(path)['sha256'] == support[name]['sha256'] for name, path in support_paths.items()),
            'PACKAGE_SUPPORT_CHANGED')
    archive_sha = sha(partial)
    descriptor = os.open(sums, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='ascii', newline='\n') as stream:
        stream.write(archive_sha + '  ' + OUT.name + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.link(partial, OUT)
    partial.unlink()
    print('PACKAGE_FILE=' + str(OUT))
    print('SHA256=' + archive_sha)
    print('SERVER_DELTA_FILES=2')
    print('WEB_DELTA_FILES=' + str(sum(name.startswith('web/') for name in delta)))
    print('PACKAGE_SIZE_BYTES=' + str(OUT.stat().st_size))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'PACKAGE_[A-Z0-9_]+', str(error)) else 'PACKAGE_BUILD_FAILED'
        raise SystemExit(code) from None
