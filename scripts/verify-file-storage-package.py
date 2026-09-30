"""Read-only verification of nested deployment archives and current source files."""
import hashlib
import json
import pathlib
import sys
import tarfile
import zipfile


def digest(stream):
    checksum = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        checksum.update(chunk)
    return checksum.hexdigest()


def safe_name(name):
    if not name or name.startswith('/') or '\\' in name or ':' in name or any(ord(c) < 32 for c in name):
        raise ValueError('Unsafe archive entry')
    parts = name.rstrip('/').split('/')
    if any(part in ('', '.', '..') for part in parts):
        raise ValueError('Unsafe archive component')
    return name.rstrip('/')


def main(package_path, project_root):
    package = pathlib.Path(package_path).resolve()
    root = pathlib.Path(project_root).resolve()
    api_name = 'outdoor-fit-api-file-storage-bilingual-registration-20260910.tar.gz'
    web_name = 'outdoor-fit-web-file-storage-bilingual-registration-20260910.zip'
    helper_names = ['configure-media-upload-proxy.cjs', 'validate-media-deploy-paths.cjs', 'validate-media-deploy-archives.cjs', 'verify-file-storage-install.cjs']
    with zipfile.ZipFile(package) as outer:
        names = [safe_name(item.filename) for item in outer.infolist()]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate outer archive entries')
        checksums = {}
        for line in outer.read('runtime-checksums.sha256').decode('ascii').splitlines():
            checksum, name = line.split('  ', 1)
            checksums[name] = checksum
        if set(checksums) != {api_name, web_name, *helper_names}:
            raise ValueError('Unexpected runtime checksum manifest')
        for name, expected in checksums.items():
            with outer.open(name) as stream:
                if digest(stream) != expected:
                    raise ValueError('Runtime checksum mismatch: ' + name)
        for name in helper_names:
            with (root / 'scripts' / name).open('rb') as source:
                if digest(source) != checksums[name]:
                    raise ValueError('Packaged helper differs from current source: ' + name)
        inventory = json.loads(outer.read('build-inventory.json'))
        expected_files = {item['Path']: item for item in inventory['ApiAndSeedFiles']}
        observed = set()
        with outer.open(api_name) as compressed:
            with tarfile.open(fileobj=compressed, mode='r|gz') as archive:
                for member in archive:
                    name = safe_name(member.name)
                    if member.isdir():
                        continue
                    if not member.isfile() or name not in expected_files or name in observed:
                        raise ValueError('Unexpected API archive file: ' + name)
                    observed.add(name)
                    expected = expected_files[name]
                    with archive.extractfile(member) as stream:
                        if digest(stream).upper() != expected['SHA256'] or member.size != expected['Bytes']:
                            raise ValueError('API content mismatch: ' + name)
                    source_path = (root / 'workspace-artifacts' / 'education-video-seed-20260910' / name[len('media-seed/'):]) if name.startswith('media-seed/') else root / 'server' / name
                    with source_path.open('rb') as source:
                        if digest(source).upper() != expected['SHA256']:
                            raise ValueError('Current source mismatch: ' + name)
        if observed != set(expected_files):
            raise ValueError('API archive does not contain all inventoried files')
        api_sources = {name for name in observed if name.startswith('src/')}
        current_sources = {file.relative_to(root / 'server').as_posix() for file in (root / 'server' / 'src').rglob('*') if file.is_file()}
        if api_sources != current_sources:
            raise ValueError('Current API source list differs from package')
        web_root = root / 'workspace-artifacts' / 'exports' / 'file-storage-bilingual-registration-20260910'
        web_files = set()
        with outer.open(web_name) as compressed:
            with zipfile.ZipFile(compressed) as archive:
                for member in archive.infolist():
                    name = safe_name(member.filename)
                    if member.is_dir():
                        continue
                    if name in web_files:
                        raise ValueError('Duplicate Web entry')
                    web_files.add(name)
                    with archive.open(member) as stream, (web_root / name).open('rb') as source:
                        if digest(stream) != digest(source):
                            raise ValueError('Web export mismatch: ' + name)
        if web_files != {file.relative_to(web_root).as_posix() for file in web_root.rglob('*') if file.is_file()}:
            raise ValueError('Web file list differs from export')
        for name, original in [('install-file-storage-bilingual-registration-20260910.sh', root / 'deploy' / '2026-09-10' / 'install-file-storage-bilingual-registration-20260910.sh'), ('file-storage-bilingual-registration-20260910.md', root / 'docs' / 'file-storage-bilingual-registration-20260910.md'), ('file-storage-education-seed-verification-20260910.md', root / 'docs' / 'file-storage-education-seed-verification-20260910.md')]:
            with outer.open(name) as stream, original.open('rb') as source:
                if digest(stream) != digest(source):
                    raise ValueError('Packaged report or installer differs: ' + name)
    with package.open('rb') as stream:
        package_hash = digest(stream).upper()
    result = {'path': str(package), 'bytes': package.stat().st_size, 'MiB': round(package.stat().st_size / 1024 / 1024, 2), 'SHA256': package_hash, 'runtimeChecksumsVerified': len(checksums), 'apiSourceFilesVerified': len(api_sources), 'apiAndSeedFilesVerified': len(observed), 'seedFilesVerified': sum(name.startswith('media-seed/files/') for name in observed), 'webFilesVerified': len(web_files), 'currentSourceAndReportsMatch': True}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main(*sys.argv[1:])
