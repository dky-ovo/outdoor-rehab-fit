#!/usr/bin/env python3
"""Package only reviewed backend changes against immutable Aliyun v1 + v2."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile

ROOT = Path(__file__).resolve().parent.parent
ANCESTOR = ROOT / 'deploy/aliyun-production/outdoor-fit-production-v1.tar.gz'
ANCESTOR_SHA = '3200ba265dc6a2f14838fa397cf73fdcf5dad7f0d3e08224affa9240a836a9a8'
ANCESTOR_PREFIX = 'outdoor-fit-production-20260924-v1'
BASELINE = ROOT / 'deploy/aliyun-fixes/outdoor-fit-fixes-20260924-v2.tar.gz'
BASELINE_SHA = '3879a96b581f47e576e24edb1db3dd9a9f6e5c3c8d3a954d60d91d9768d79c99'
BASELINE_PREFIX = 'outdoor-fit-fixes-20260924-v2'
PREFIX = 'outdoor-fit-equipment-image-cleanup-20260924-v3'
OUT = ROOT / ('deploy/aliyun-equipment-image-cleanup/' + PREFIX + '.tar.gz')
PRESERVE = ['deploy/aliyun-production/Caddyfile', 'deploy/aliyun-production/compose.yaml']
SERVER_CHANGES = {'server/src/appMysql.js', 'server/src/production.js',
                  'server/src/mysqlMediaLibrary.js', 'server/src/mysqlEquipmentImageRetirement.js'}
SUPPORT = ['apply-update.py', 'Dockerfile', 'Dockerfile.dockerignore', 'README.md',
           'check-cleanup-readiness.mjs']


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


def archive_records(file, expected_sha, prefix):
    require(sha(safe_file(file)) == expected_sha, 'PACKAGE_BASELINE_HASH_MISMATCH')
    result = {}
    with tarfile.open(file, 'r:gz') as archive:
        for item in archive:
            if item.isdir():
                continue
            require(item.isfile() and item.name.startswith(prefix + '/'), 'PACKAGE_BASELINE_MEMBER_INVALID')
            relative = item.name[len(prefix) + 1:]
            safe_name(relative)
            require(relative not in result, 'PACKAGE_BASELINE_DUPLICATE')
            hasher = hashlib.sha256()
            with archive.extractfile(item) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    hasher.update(block)
            result[relative] = {'sha256': hasher.hexdigest(), 'size': item.size, 'mode': item.mode & 0o777}
    return result


def read_baseline():
    ancestor = archive_records(ANCESTOR, ANCESTOR_SHA, ANCESTOR_PREFIX)
    entries = archive_records(BASELINE, BASELINE_SHA, BASELINE_PREFIX)
    with tarfile.open(BASELINE, 'r:gz') as archive:
        raw = archive.extractfile(BASELINE_PREFIX + '/release-manifest.json').read()
    manifest = json.loads(raw)
    require(manifest['baselineFiles'] == ancestor and manifest['baselineArchiveSha256'] == ANCESTOR_SHA
            and manifest['releaseTag'] == '20260924-v2' and manifest['baselineTag'] == '20260924-v1',
            'PACKAGE_BASELINE_CHAIN_MISMATCH')
    expected = {'release-manifest.json'} | set(manifest['supportFiles']) | {'payload/' + name for name in manifest['deltaFiles']}
    require(set(entries) == expected, 'PACKAGE_BASELINE_CONTENT_MISMATCH')
    for name, record in manifest['supportFiles'].items():
        require(entries[name] == record, 'PACKAGE_BASELINE_CONTENT_MISMATCH')
    for name, record in manifest['deltaFiles'].items():
        require(entries['payload/' + name] == record, 'PACKAGE_BASELINE_CONTENT_MISMATCH')
    result = dict(ancestor, **manifest['deltaFiles'])
    # These two support files were installed by v2 alongside the runtime tree.
    result.update({'deploy/aliyun-fixes/' + name: manifest['supportFiles'][name]
                   for name in ('Dockerfile', 'Dockerfile.dockerignore')})
    require(len(result) == 323 and sum(name.startswith('server/') for name in result) == 63
            and sum(name.startswith('web/') for name in result) == 248, 'PACKAGE_BASELINE_FILE_COUNT')
    return result, hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument('--build', action='store_true')
    actions.add_argument('--check', action='store_true')
    args = parser.parse_args()
    baseline, baseline_manifest_sha = read_baseline()
    sources = inventory(ROOT / 'server/src', 'server/src')
    require(all(path.endswith(('.js', '.json')) for path in sources), 'PACKAGE_SERVER_FILE_UNEXPECTED')
    for name in ('package.json', 'package-lock.json'):
        sources['server/' + name] = safe_file(ROOT / 'server' / name)
    baseline_server = {name for name in baseline if name.startswith('server/')}
    require(baseline_server <= sources.keys(), 'PACKAGE_SERVER_DELETION_REFUSED')
    require(set(sources) - baseline_server == {'server/src/mysqlEquipmentImageRetirement.js'}, 'PACKAGE_NEW_SERVER_FILE_UNEXPECTED')
    current = sources
    records = {name: metadata(path) for name, path in current.items()}
    delta = {name: record for name, record in records.items()
             if name not in baseline or record['sha256'] != baseline[name]['sha256']}
    require({name for name in delta if name.startswith('server/')} == SERVER_CHANGES,
            'PACKAGE_SERVER_CHANGE_SCOPE_MISMATCH')
    support_paths = {name: safe_file(ROOT / 'deploy/aliyun-equipment-image-cleanup' / name) for name in SUPPORT}
    support = {name: metadata(path) for name, path in support_paths.items()}
    manifest = {'formatVersion': 2, 'releaseTag': '20260924-v3', 'baselineTag': '20260924-v2',
                'baselineArchiveSha256': BASELINE_SHA, 'baselineFiles': baseline,
                'ancestorArchiveSha256': ANCESTOR_SHA, 'baselineManifestSha256': baseline_manifest_sha,
                'preserveLive': PRESERVE, 'deltaFiles': delta, 'supportFiles': support,
                'preserveWebDirectory': '/opt/outdoor-fit/production/releases/outdoor-fit-production-20260924-v2/web'}
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')
    if args.check:
        print('PACKAGE_SOURCE_CHECK=PASS')
        print('BASELINE_FILES=' + str(len(baseline)))
        print('SERVER_DELTA_FILES=' + str(len(delta)))
        print('WEB_DELTA_FILES=0')
        return
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
    print('SERVER_DELTA_FILES=' + str(len(delta)))
    print('WEB_DELTA_FILES=0')
    print('PACKAGE_SIZE_BYTES=' + str(OUT.stat().st_size))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'PACKAGE_[A-Z0-9_]+', str(error)) else 'PACKAGE_BUILD_FAILED'
        raise SystemExit(code) from None
