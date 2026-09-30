"""Seal a new v11 server/web delta without changing any previous delivery."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'outdoor-fit-account-data-20260930-v11'
SUPPORT = ROOT / 'deploy/account-data-20260930-v11'
OUT = SUPPORT / (PREFIX + '-delta.tar.gz')
CHECKSUM = SUPPORT / 'SHA256SUMS'
BASELINES = {
    'outdoor-fit-api:20260928-v9': (
        'deploy/account-continuity-20260928/outdoor-fit-account-continuity-20260928-v9-delta.tar.gz',
        'outdoor-fit-account-continuity-20260928-v9',
        'f5b0b4ea109ab13817122774df17143a4f4af17fe5535a89b2ab2f3fa0fed6be'),
    'outdoor-fit-api:20260928-v10': (
        'deploy/account-data-20260928/outdoor-fit-account-data-20260928-v10-delta.tar.gz',
        'outdoor-fit-account-data-20260928-v10',
        '8365ac7d0518e3abb57382fd7811bfffcd00b8b015c313902b698bfd8a97a9bd'),
}
SUPPORT_FILES = ['Dockerfile', 'Dockerfile.dockerignore', 'schema.sql', 'migrate.mjs', 'install.py', 'README.md']


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def refuse_existing_outputs():
    require(not any(path.exists() or path.is_symlink() for path in (OUT, CHECKSUM)), 'PACKAGE_ALREADY_SEALED')


def read_baselines():
    result = {}
    for image, (name, prefix, expected) in BASELINES.items():
        archive_path = ROOT / name
        require(archive_path.is_file() and not archive_path.is_symlink(), 'BASELINE_MISSING')
        require(digest(archive_path.read_bytes()) == expected, 'BASELINE_ARCHIVE_CHANGED')
        with tarfile.open(archive_path, 'r:gz') as archive:
            result[image] = json.load(archive.extractfile(prefix + '/manifest.json'))['webFiles']
    return result


def reusable_web(name, checksum, baselines):
    # A single v11 package works on either deployed version. Omit a payload only
    # if both complete baseline manifests attest to the same existing bytes.
    return bool(baselines) and all(files.get(name) == checksum for files in baselines.values())


def safe_relative(name):
    path = PurePosixPath(name)
    require(name and '\\' not in name and ':' not in name and not path.is_absolute()
            and '..' not in path.parts and path.as_posix() == name, 'PACKAGE_PATH_INVALID')
    # Metro exports dependency icons/fonts under assets/node_modules. These
    # public static assets are not an installed dependency tree or source code.
    exported_asset = path.parts[:3] == ('web', 'assets', 'node_modules') and path.suffix.lower() in {
        '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ttf', '.otf', '.woff', '.woff2'}
    require(not any(part.lower() == 'node_modules' for part in path.parts) or exported_asset, 'PRIVATE_FILE_REFUSED')
    require(not any(part.startswith('.') or part.lower() in {'secrets', 'credentials', '__pycache__'}
                    for part in path.parts), 'PRIVATE_FILE_REFUSED')
    require(path.suffix.lower() not in {'.pem', '.sqlite', '.db', '.key', '.pyc', '.map'}, 'PRIVATE_FILE_REFUSED')


def collect(web, baselines):
    require(web.is_dir() and not web.is_symlink() and (web / 'index.html').is_file(), 'WEB_EXPORT_REQUIRED')
    files, web_files = {}, {}
    for base, prefix in [(ROOT / 'server/src', 'server/src'), (web, 'web')]:
        for path in sorted(base.rglob('*')):
            require(not path.is_symlink(), 'PACKAGE_LINK_REFUSED')
            if path.is_dir():
                continue
            require(path.is_file(), 'PACKAGE_SPECIAL_FILE_REFUSED')
            name = prefix + '/' + path.relative_to(base).as_posix()
            safe_relative(name)
            if prefix == 'web':
                web_files[name] = digest(path.read_bytes())
                if reusable_web(name, web_files[name], baselines):
                    continue
            files[name] = path
    for name in SUPPORT_FILES:
        path = SUPPORT / name
        require(path.is_file() and not path.is_symlink(), 'SUPPORT_FILE_REQUIRED')
        files[name] = path
    return files, web_files


def add_bytes(archive, name, data):
    item = tarfile.TarInfo(PREFIX + '/' + name)
    item.size = len(data)
    item.mode = 0o644
    archive.addfile(item, io.BytesIO(data))


def seal(web):
    # No helper or output write may happen before this refusal.
    refuse_existing_outputs()
    baselines = read_baselines()
    files, web_files = collect(web, baselines)
    records = {name: digest(path.read_bytes()) for name, path in sorted(files.items())}
    manifest = {'release': PREFIX, 'baselines': list(BASELINES), 'files': records, 'webFiles': web_files}
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
    # Detect edits to both omitted and included web files before reporting success.
    current_files, current_web = collect(web, baselines)
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--web-dir', type=Path, required=True, help='Fresh web-only Expo export after code/tests are stable')
    args = parser.parse_args()
    seal(args.web_dir.resolve())


if __name__ == '__main__':
    main()
