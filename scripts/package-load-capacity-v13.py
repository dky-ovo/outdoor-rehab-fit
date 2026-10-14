"""Seal the v12-only load-capacity backend/web update; never deploy or publish."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'outdoor-fit-load-capacity-20261002-v13'
SUPPORT = ROOT / 'deploy/load-capacity-20261002-v13'
OUT = SUPPORT / (PREFIX + '-delta.tar.gz')
CHECKSUM = SUPPORT / 'SHA256SUMS'
BASELINE_IMAGE = 'outdoor-fit-api:20261002-v12'
BASELINE_PREFIX = 'outdoor-fit-app-suggestions-20261002-v12'
BASELINE_PATH = ROOT / 'deploy/app-suggestions-20261002-v12' / (BASELINE_PREFIX + '-delta.tar.gz')
BASELINE_SHA = '57b8272d6431be65816094484020658b1ac0bcd332e08e76ce2c5026d94e254a'
SERVER_FILES = ('appMysql.js', 'mysqlConfig.js', 'mysqlDatabase.js', 'lastSeenPolicy.js')
SUPPORT_FILES = ('Dockerfile', 'Dockerfile.dockerignore', 'install.py', 'README.md')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_relative(name):
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name, 'PACKAGE_PATH_INVALID')
    path = PurePosixPath(name)
    require(not path.is_absolute() and '..' not in path.parts and path.as_posix() == name, 'PACKAGE_PATH_INVALID')
    exported_asset = path.parts[:3] == ('web', 'assets', 'node_modules') and path.suffix.lower() in {
        '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ttf', '.otf', '.woff', '.woff2'}
    require(not any(part.lower() == 'node_modules' for part in path.parts) or exported_asset, 'PRIVATE_FILE_REFUSED')
    require(not any(part.startswith('.') or part.lower() in {'private', 'secrets', 'credentials', '__pycache__'}
                    for part in path.parts), 'PRIVATE_FILE_REFUSED')
    require(path.suffix.lower() not in {'.pem', '.sqlite', '.db', '.key', '.pyc', '.map', '.docx'}, 'PRIVATE_FILE_REFUSED')
    return path


def read_baseline():
    require(BASELINE_PATH.is_file() and not BASELINE_PATH.is_symlink(), 'BASELINE_MISSING')
    require(digest(BASELINE_PATH.read_bytes()) == BASELINE_SHA, 'BASELINE_ARCHIVE_CHANGED')
    with tarfile.open(BASELINE_PATH, 'r:gz') as archive:
        baseline = json.load(archive.extractfile(BASELINE_PREFIX + '/manifest.json'))
        require(baseline.get('release') == BASELINE_PREFIX, 'BASELINE_MANIFEST_INVALID')
        sources = {name: checksum for name, checksum in baseline['files'].items() if name.startswith('server/src/')}
        require(sources and 'server/src/lastSeenPolicy.js' not in sources, 'BASELINE_SOURCES_INVALID')
        for name, expected in sources.items():
            safe_relative(name)
            require(digest(archive.extractfile(BASELINE_PREFIX + '/' + name).read()) == expected, 'BASELINE_SOURCE_CHANGED')
        web = baseline['webFiles']
        require(web and 'web/index.html' in web, 'BASELINE_WEB_INVALID')
        return sources, web


def collect(web, baseline_web):
    require(web.is_dir() and not web.is_symlink() and (web / 'index.html').is_file(), 'WEB_EXPORT_REQUIRED')
    files, web_files = {}, {}
    for name in SERVER_FILES:
        relative = 'server/src/' + name
        path = ROOT / relative
        require(path.is_file() and not path.is_symlink(), 'SERVER_FIX_REQUIRED')
        files[relative] = path
    for path in sorted(web.rglob('*')):
        require(not path.is_symlink(), 'PACKAGE_LINK_REFUSED')
        if path.is_dir():
            continue
        require(path.is_file(), 'PACKAGE_SPECIAL_FILE_REFUSED')
        name = 'web/' + path.relative_to(web).as_posix()
        safe_relative(name)
        web_files[name] = digest(path.read_bytes())
        if baseline_web.get(name) != web_files[name]:
            files[name] = path
    for name in SUPPORT_FILES:
        path = SUPPORT / name
        require(path.is_file() and not path.is_symlink(), 'SUPPORT_FILE_REQUIRED')
        files[name] = path
    return files, web_files


def add_bytes(archive, name, data):
    item = tarfile.TarInfo(PREFIX + '/' + name)
    item.size, item.mode, item.mtime = len(data), 0o644, 0
    archive.addfile(item, io.BytesIO(data))


def seal(web):
    require(not any(path.exists() or path.is_symlink() for path in (OUT, CHECKSUM)), 'PACKAGE_ALREADY_SEALED')
    baseline_sources, baseline_web = read_baseline()
    files, web_files = collect(web, baseline_web)
    records = {name: digest(path.read_bytes()) for name, path in sorted(files.items())}
    manifest = {'release': PREFIX, 'baselineImage': BASELINE_IMAGE, 'baselineArchiveSha256': BASELINE_SHA,
                'files': records, 'baselineSourceFiles': baseline_sources, 'baselineWebFiles': baseline_web,
                'webFiles': web_files}
    with OUT.open('xb') as output, tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, path in sorted(files.items()):
            data = path.read_bytes()
            require(digest(data) == records[name], 'SOURCE_CHANGED_DURING_SEAL')
            add_bytes(archive, name, data)
        add_bytes(archive, 'manifest.json', json.dumps(manifest, indent=2).encode() + b'\n')
    with tarfile.open(OUT, 'r:gz') as archive:
        expected_names = {PREFIX + '/' + name for name in records} | {PREFIX + '/manifest.json'}
        members = archive.getmembers()
        require(len(members) == len(expected_names) and {item.name for item in members} == expected_names
                and all(item.isfile() for item in members), 'ARCHIVE_FILESET_MISMATCH')
        for name, expected in records.items():
            require(digest(archive.extractfile(PREFIX + '/' + name).read()) == expected, 'ARCHIVE_HASH_MISMATCH')
    current_files, current_web = collect(web, baseline_web)
    require(current_web == web_files and set(current_files) == set(files)
            and all(digest(path.read_bytes()) == records[name] for name, path in current_files.items()),
            'SOURCE_CHANGED_DURING_SEAL')
    checksum = digest(OUT.read_bytes())
    with CHECKSUM.open('x', encoding='ascii') as stream:
        stream.write(checksum + '  ' + OUT.name + '\n')
    print('PACKAGE_FILE=' + str(OUT))
    print('PACKAGE_BYTES=' + str(OUT.stat().st_size))
    print('SHA256=' + checksum)
    print('PACKAGE_VERIFIED=PASS')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-dir', type=Path, required=True)
    args = parser.parse_args()
    seal(args.web_dir.resolve())
