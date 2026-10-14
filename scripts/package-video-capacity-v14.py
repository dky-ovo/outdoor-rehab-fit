"""Seal the verified v13-to-v14 public-video and web delta; never deploy."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile

ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'outdoor-fit-video-capacity-20261003-v14'
SUPPORT = ROOT / 'deploy/video-capacity-20261003-v14'
OUT = SUPPORT / (PREFIX + '-delta.tar.gz')
CHECKSUM = SUPPORT / 'SHA256SUMS'
BASELINE_IMAGE = 'outdoor-fit-api:20261002-v13'
BASELINE_PREFIX = 'outdoor-fit-load-capacity-20261002-v13'
BASELINE_PATH = ROOT / 'deploy/load-capacity-20261002-v13' / (BASELINE_PREFIX + '-delta.tar.gz')
BASELINE_SHA = '66ce313262affcb8fbe375b138fd47d8cb8d4337a3c69e2924464544098a987f'
SERVER_FILES = ('app.js', 'appMysql.js', 'production.js', 'mediaLibrary.js',
                'mysqlMediaLibrary.js', 'publicVideoDelivery.js')
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
        sources = dict(baseline['baselineSourceFiles'])
        for name, checksum in baseline['files'].items():
            if name.startswith('server/src/'):
                safe_relative(name)
                require(digest(archive.extractfile(BASELINE_PREFIX + '/' + name).read()) == checksum,
                        'BASELINE_SOURCE_CHANGED')
                sources[name] = checksum
        require(sources and 'server/src/lastSeenPolicy.js' in sources, 'BASELINE_SOURCES_INVALID')
        web = baseline['webFiles']
        require(web and 'web/index.html' in web, 'BASELINE_WEB_INVALID')
        return sources, web


def collect(web, media, baseline_web, baseline_sources):
    require(web.is_dir() and not web.is_symlink() and (web / 'index.html').is_file(), 'WEB_EXPORT_REQUIRED')
    require(media.is_dir() and not media.is_symlink() and (media / 'manifest.json').is_file(), 'MEDIA_MANIFEST_REQUIRED')
    media_manifest = json.loads((media / 'manifest.json').read_text(encoding='utf-8'))
    require(media_manifest.get('version') == 1 and media_manifest.get('complete') is True
            and media_manifest.get('entries'), 'MEDIA_ENCODING_INCOMPLETE')
    require(all(entry.get('visualReviewPassed') is True for entry in media_manifest['entries']), 'MEDIA_VISUAL_REVIEW_REQUIRED')
    files, web_files = {}, {}
    for name in SERVER_FILES:
        relative = 'server/src/' + name
        source = ROOT / relative
        require(source.is_file() and not source.is_symlink(), 'SERVER_FIX_REQUIRED')
        files[relative] = source
    # Verify unrelated runtime modules still match the sealed deployed v13.
    for relative, checksum in baseline_sources.items():
        if relative not in files:
            require(digest((ROOT / relative).read_bytes()) == checksum, 'UNRELATED_RUNTIME_SOURCE_DRIFT')
    for source in sorted(web.rglob('*')):
        require(not source.is_symlink(), 'PACKAGE_LINK_REFUSED')
        if source.is_dir():
            continue
        require(source.is_file(), 'PACKAGE_SPECIAL_FILE_REFUSED')
        name = 'web/' + source.relative_to(web).as_posix()
        safe_relative(name)
        web_files[name] = digest(source.read_bytes())
        if baseline_web.get(name) != web_files[name]:
            files[name] = source
    derivatives = media / 'derivatives'
    require(derivatives.is_dir() and not derivatives.is_symlink(), 'MEDIA_DERIVATIVES_REQUIRED')
    media_payload = [media / 'manifest.json', *sorted(derivatives.iterdir())]
    for source in media_payload:
        require(not source.is_symlink(), 'PACKAGE_LINK_REFUSED')
        require(source.is_file(), 'MEDIA_SPECIAL_FILE_REFUSED')
        relative = source.relative_to(media).as_posix()
        require(relative == 'manifest.json' or
                (relative.startswith('derivatives/') and source.suffix == '.mp4'), 'MEDIA_PAYLOAD_FILE_REFUSED')
        name = 'media/' + relative
        safe_relative(name)
        files[name] = source
    for name in SUPPORT_FILES:
        source = SUPPORT / name
        require(source.is_file() and not source.is_symlink(), 'SUPPORT_FILE_REQUIRED')
        files[name] = source
    return files, web_files


def add_bytes(archive, name, data):
    item = tarfile.TarInfo(PREFIX + '/' + name)
    item.size, item.mode, item.mtime = len(data), 0o644, 0
    archive.addfile(item, io.BytesIO(data))


def seal(web, media):
    require(not any(path.exists() or path.is_symlink() for path in (OUT, CHECKSUM)), 'PACKAGE_ALREADY_SEALED')
    baseline_sources, baseline_web = read_baseline()
    files, web_files = collect(web, media, baseline_web, baseline_sources)
    records = {name: digest(source.read_bytes()) for name, source in sorted(files.items())}
    manifest = {'release': PREFIX, 'baselineImage': BASELINE_IMAGE, 'baselineArchiveSha256': BASELINE_SHA,
                'files': records, 'baselineSourceFiles': baseline_sources, 'baselineWebFiles': baseline_web,
                'webFiles': web_files, 'mediaManifestSha256': records['media/manifest.json']}
    with OUT.open('xb') as output, tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, source in sorted(files.items()):
            data = source.read_bytes()
            require(digest(data) == records[name], 'SOURCE_CHANGED_DURING_SEAL')
            add_bytes(archive, name, data)
        add_bytes(archive, 'manifest.json', json.dumps(manifest, indent=2).encode() + b'\n')
    with tarfile.open(OUT, 'r:gz') as archive:
        expected = {PREFIX + '/' + name for name in records} | {PREFIX + '/manifest.json'}
        members = archive.getmembers()
        require(len(members) == len(expected) and {item.name for item in members} == expected
                and all(item.isfile() for item in members), 'ARCHIVE_FILESET_MISMATCH')
        for name, checksum in records.items():
            require(digest(archive.extractfile(PREFIX + '/' + name).read()) == checksum, 'ARCHIVE_HASH_MISMATCH')
    current_files, current_web = collect(web, media, baseline_web, baseline_sources)
    require(current_web == web_files and set(current_files) == set(files)
            and all(digest(source.read_bytes()) == records[name] for name, source in current_files.items()),
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
    parser.add_argument('--media-dir', type=Path, required=True)
    args = parser.parse_args()
    seal(args.web_dir.resolve(), args.media_dir.resolve())
