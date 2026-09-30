"""Read-only SHA-256 verification of the explorer deployment and nested payloads.

No archives are extracted and no production/API calls are made.  The verifier
compares the actual archived bytes with the inventory AND current local sources.
"""
import hashlib
import json
import pathlib
import re
import stat
import sys
import tarfile
import zipfile


API_NAME = 'outdoor-fit-api-pdf-app-timer-20260911.tar.gz'
WEB_NAME = 'outdoor-fit-web-pdf-app-timer-20260911.zip'
INSTALLER = 'install-pdf-app-timer-20260911.sh'
HELPERS = [
    'configure-media-upload-proxy.cjs',
    'validate-media-deploy-paths.cjs',
    'validate-media-deploy-archives.cjs',
    'verify-file-storage-install.cjs',
    'check-media-deploy-space.cjs',
]
REPORTS = [
    'pdf-app-timer-20260911.md',
    'svar-file-explorer-20260910.md',
    'file-storage-education-seed-verification-20260910.md',
]
SEED_SHA256 = '8340866AE6E02AD1E6F1EE81A46966D84A9311AA5D8562A63FCCA078F0A7EF39'
MAX_PAYLOAD_BYTES = 100 * 1024 ** 3


def digest(stream):
    checksum = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        checksum.update(chunk)
    return checksum.hexdigest()


def safe_name(name):
    if not name or name.startswith('/') or '\\' in name or ':' in name or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError('Unsafe archive entry')
    parts = name.rstrip('/').split('/')
    if any(part in ('', '.', '..') for part in parts):
        raise ValueError('Unsafe archive component')
    return name.rstrip('/')


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON property: ' + key)
        result[key] = value
    return result


def read_json(data):
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique_object)


def zip_entries(archive):
    entries = {}
    for member in archive.infolist():
        name = safe_name(member.filename)
        if name in entries:
            raise ValueError('Duplicate ZIP entry: ' + name)
        mode = stat.S_IFMT(member.external_attr >> 16)
        if member.flag_bits & 1 or mode not in (0, stat.S_IFREG, stat.S_IFDIR):
            raise ValueError('Encrypted, linked or special ZIP entry: ' + name)
        entries[name] = member
    return entries


def source_file(base, relative):
    candidate = base / safe_name(relative)
    if candidate.is_symlink() or not candidate.is_file():
        raise ValueError('Current source is missing, linked or not a regular file: ' + relative)
    try:
        candidate.resolve().relative_to(base.resolve())
    except ValueError as error:
        raise ValueError('Current source escapes its expected directory: ' + relative) from error
    return candidate


def validate_sizes(value):
    if not isinstance(value, dict) or type(value.get('version')) is not int or value['version'] != 1 or value.get('apiArchive') != API_NAME or value.get('webArchive') != WEB_NAME:
        raise ValueError('Unexpected deployment size manifest')
    for key in ('apiArchiveBytes', 'webArchiveBytes', 'apiExpandedBytes', 'webExpandedBytes'):
        if type(value.get(key)) is not int or not 0 < value[key] <= MAX_PAYLOAD_BYTES:
            raise ValueError('Invalid deployment payload size: ' + key)
    return value


def main(package_path, project_root):
    package = pathlib.Path(package_path).resolve()
    root = pathlib.Path(project_root).resolve()
    seed_root = root / 'workspace-artifacts' / 'education-video-seed-20260910'
    web_root = root / 'workspace-artifacts' / 'exports' / 'pdf-app-timer-20260911'
    expected_outer = {API_NAME, WEB_NAME, INSTALLER, *HELPERS, *REPORTS, 'deployment-sizes.json', 'runtime-checksums.sha256', 'build-inventory.json'}
    runtime_names = {API_NAME, WEB_NAME, *HELPERS, 'deployment-sizes.json'}
    with zipfile.ZipFile(package) as outer:
        entries = zip_entries(outer)
        if set(entries) != expected_outer or any(member.is_dir() or '/' in name for name, member in entries.items()):
            raise ValueError('Unexpected or missing outer package entries')
        checksums = {}
        for line in outer.read('runtime-checksums.sha256').decode('ascii').splitlines():
            matched = re.fullmatch(r'([0-9a-fA-F]{64})  ([^\s]+)', line)
            if not matched or matched[2] in checksums:
                raise ValueError('Invalid or duplicate runtime checksum entry')
            checksums[safe_name(matched[2])] = matched[1].lower()
        if set(checksums) != runtime_names:
            raise ValueError('Unexpected runtime checksum manifest')
        for name, expected in checksums.items():
            with outer.open(name) as stream:
                if digest(stream) != expected:
                    raise ValueError('Runtime checksum mismatch: ' + name)
        for name in HELPERS:
            with source_file(root / 'scripts', name).open('rb') as source:
                if digest(source) != checksums[name]:
                    raise ValueError('Packaged helper differs from current source: ' + name)

        sizes = validate_sizes(read_json(outer.read('deployment-sizes.json')))
        if entries[API_NAME].file_size != sizes['apiArchiveBytes'] or entries[WEB_NAME].file_size != sizes['webArchiveBytes']:
            raise ValueError('Nested archive byte sizes differ from deployment size manifest')
        inventory = read_json(outer.read('build-inventory.json'))
        if inventory.get('SeedImportId') != 'education-videos-20260910' or inventory.get('SeedFiles') != 57 or inventory.get('ReviewedVideoBindings') != 54:
            raise ValueError('Unexpected seed inventory identity or counts')
        if not isinstance(inventory.get('ApiAndSeedFiles'), list):
            raise ValueError('API inventory must be a file list')
        expected_files = {}
        for item in inventory['ApiAndSeedFiles']:
            name = safe_name(item.get('Path', ''))
            if name in expected_files or name.split('/')[0] not in {'src', 'media-seed', 'package.json', 'package-lock.json'}:
                raise ValueError('Duplicate or unexpected API inventory entry: ' + name)
            if type(item.get('Bytes')) is not int or item['Bytes'] < 0 or not re.fullmatch(r'[0-9A-Fa-f]{64}', item.get('SHA256', '')):
                raise ValueError('Invalid API inventory size or checksum: ' + name)
            expected_files[name] = item
        if sum(item['Bytes'] for item in expected_files.values()) != sizes['apiExpandedBytes']:
            raise ValueError('API inventory total differs from deployment size manifest')

        observed, tar_names = {}, set()
        with outer.open(API_NAME) as compressed:
            with tarfile.open(fileobj=compressed, mode='r|gz') as archive:
                for member in archive:
                    name = safe_name(member.name)
                    if name in tar_names or name.split('/')[0] not in {'src', 'media-seed', 'package.json', 'package-lock.json'}:
                        raise ValueError('Duplicate or unexpected TAR entry: ' + name)
                    tar_names.add(name)
                    if member.isdir():
                        continue
                    if not member.isfile() or name not in expected_files:
                        raise ValueError('Unexpected, linked or special API archive file: ' + name)
                    expected = expected_files[name]
                    with archive.extractfile(member) as stream:
                        checksum = digest(stream).upper()
                    if checksum != expected['SHA256'].upper() or member.size != expected['Bytes']:
                        raise ValueError('API content mismatch: ' + name)
                    source_path = source_file(seed_root, name[len('media-seed/'):]) if name.startswith('media-seed/') else source_file(root / 'server', name)
                    with source_path.open('rb') as source:
                        if digest(source).upper() != checksum or source_path.stat().st_size != member.size:
                            raise ValueError('Current API or seed source mismatch: ' + name)
                    observed[name] = {'Bytes': member.size, 'SHA256': checksum}
        if set(observed) != set(expected_files):
            raise ValueError('API archive does not contain all inventoried files')
        if sum(item['Bytes'] for item in observed.values()) != sizes['apiExpandedBytes']:
            raise ValueError('Actual expanded API bytes differ from deployment size manifest')
        api_sources = {name for name in observed if name.startswith('src/')}
        current_sources = {file.relative_to(root / 'server').as_posix() for file in (root / 'server' / 'src').rglob('*') if file.is_file()}
        if api_sources != current_sources or 'src/mediaFileOperations.js' not in api_sources:
            raise ValueError('Current API source list differs from the explorer package')
        required_api = api_sources | {'package.json', 'package-lock.json', 'media-seed/manifest.json'}
        # The local verification.json report is not part of the runtime seed.
        current_seed_files = {'media-seed/manifest.json'} | {'media-seed/' + file.relative_to(seed_root).as_posix() for file in (seed_root / 'files').rglob('*') if file.is_file()}
        if set(observed) != required_api | current_seed_files:
            raise ValueError('Current seed file list differs from package')
        if observed['media-seed/manifest.json']['SHA256'] != SEED_SHA256:
            raise ValueError('Reviewed education seed manifest has changed')
        with source_file(seed_root, 'manifest.json').open('rb') as source:
            manifest = read_json(source.read())
        if manifest.get('importId') != 'education-videos-20260910' or len(manifest.get('items', [])) != 57 or sum(item.get('equipmentId') is not None for item in manifest['items']) != 54:
            raise ValueError('Reviewed seed contents have unexpected counts')
        seed_names = set()
        for item in manifest['items']:
            name = 'media-seed/files/' + safe_name(item['fileName'])
            if name in seed_names or '/' in item['fileName'] or name not in observed:
                raise ValueError('Duplicate or missing reviewed seed file')
            seed_names.add(name)
            if observed[name]['SHA256'] != item['sha256'].upper() or observed[name]['Bytes'] != item['size']:
                raise ValueError('Reviewed seed file differs from actual archive: ' + name)
        if seed_names != {name for name in observed if name.startswith('media-seed/files/')}:
            raise ValueError('Unexpected seed files in archive')

        web_files, web_bytes = set(), 0
        with outer.open(WEB_NAME) as compressed:
            with zipfile.ZipFile(compressed) as archive:
                for name, member in zip_entries(archive).items():
                    if member.is_dir():
                        continue
                    web_files.add(name)
                    original = source_file(web_root, name)
                    with archive.open(member) as stream, original.open('rb') as source:
                        if digest(stream) != digest(source) or member.file_size != original.stat().st_size:
                            raise ValueError('Web export mismatch: ' + name)
                    web_bytes += member.file_size
        if web_files != {file.relative_to(web_root).as_posix() for file in web_root.rglob('*') if file.is_file()}:
            raise ValueError('Web file list differs from current export')
        if web_bytes != sizes['webExpandedBytes']:
            raise ValueError('Actual expanded Web bytes differ from deployment size manifest')
        for name, base in [(INSTALLER, root / 'deploy' / '2026-09-11'), *[(name, root / 'docs') for name in REPORTS]]:
            with outer.open(name) as stream, source_file(base, name).open('rb') as source:
                if digest(stream) != digest(source):
                    raise ValueError('Packaged report or installer differs: ' + name)

    with package.open('rb') as stream:
        package_hash = digest(stream).upper()
    result = {
        'path': str(package), 'bytes': package.stat().st_size,
        'MiB': round(package.stat().st_size / 1024 / 1024, 2), 'SHA256': package_hash,
        'outerFilesVerified': len(entries), 'runtimeChecksumsVerified': len(checksums),
        'apiSourceFilesVerified': len(api_sources), 'apiAndSeedFilesVerified': len(observed),
        'seedFilesVerified': len(seed_names), 'reviewedBilingualBindings': 54,
        'webFilesVerified': len(web_files), 'helpersVerified': len(HELPERS),
        'reportsVerified': len(REPORTS), 'installerMatchesCurrentSource': True,
        'deploymentSizesVerified': sizes, 'currentSourceAndReportsMatch': True,
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: verify-pdf-app-timer-package.py PACKAGE_ZIP PROJECT_ROOT')
    main(*sys.argv[1:])


