"""Resume this reviewed deployment without duplicating the 325 MB API seed.

verify-api is strictly read-only. finalize must only be run once the final Web
export and reports are ready. It replaces only this task's staged Web archive;
the verified API archive, source files, old deployments and media are preserved.
"""
import contextlib
import hashlib
import io
import json
import os
import pathlib
import runpy
import shutil
import sys
import tarfile
import zipfile


sys.dont_write_bytecode = True
VERIFY = runpy.run_path(str(pathlib.Path(__file__).with_name('verify-file-explorer-package.py')))
API_NAME = VERIFY['API_NAME']
WEB_NAME = VERIFY['WEB_NAME']
INSTALLER = VERIFY['INSTALLER']
HELPERS = VERIFY['HELPERS']
REPORTS = VERIFY['REPORTS']
PACKAGE_NAME = 'outdoor-fit-file-explorer-video-20260910-update.zip'
STAGE_NAME = 'file-explorer-package-55658051c15545debdb15201b6230f75'
RESERVE_BYTES = 64 * 1024 ** 2


def paths(project_root, stage_root):
    root = pathlib.Path(project_root).resolve()
    supplied_stage = pathlib.Path(stage_root).absolute()
    stage = supplied_stage.resolve()
    expected = root / 'workspace-artifacts' / STAGE_NAME
    if stage != expected or supplied_stage.is_symlink() or not stage.is_dir():
        raise ValueError('Only this task-owned resume stage is permitted')
    package_stage = stage / 'package'
    if package_stage.is_symlink() or not package_stage.is_dir() or package_stage.resolve() != package_stage:
        raise ValueError('Package staging directory is missing or linked')
    return root, stage, package_stage


def file_hash(file):
    with file.open('rb') as stream:
        return VERIFY['digest'](stream).upper()


def verify_existing_api(project_root, stage_root):
    root, stage, package_stage = paths(project_root, stage_root)
    inventory_file = VERIFY['source_file'](package_stage, 'build-inventory.json')
    inventory = VERIFY['read_json'](inventory_file.read_bytes())
    sizes = VERIFY['validate_sizes'](VERIFY['read_json'](VERIFY['source_file'](package_stage, 'deployment-sizes.json').read_bytes()))
    if inventory.get('SeedImportId') != 'education-videos-20260910' or inventory.get('SeedFiles') != 57 or inventory.get('ReviewedVideoBindings') != 54:
        raise ValueError('Resume inventory does not describe the reviewed 57-file seed')
    expected = {}
    for item in inventory.get('ApiAndSeedFiles', []):
        name = VERIFY['safe_name'](item['Path'])
        if name in expected or name.split('/')[0] not in {'src', 'media-seed', 'package.json', 'package-lock.json'}:
            raise ValueError('Duplicate or unsafe API inventory path')
        expected[name] = item
    if not expected or sum(item['Bytes'] for item in expected.values()) != sizes['apiExpandedBytes']:
        raise ValueError('API inventory size differs from original size metadata')
    api_archive = VERIFY['source_file'](package_stage, API_NAME)
    if api_archive.stat().st_size != sizes['apiArchiveBytes']:
        raise ValueError('Existing API archive is incomplete or has a different size')
    api_checksum = None
    for line in VERIFY['source_file'](package_stage, 'runtime-checksums.sha256').read_text(encoding='ascii').splitlines():
        parts = line.split('  ', 1)
        if len(parts) == 2 and parts[1] == API_NAME:
            if api_checksum is not None:
                raise ValueError('Duplicate API checksum')
            api_checksum = parts[0].upper()
    archive_sha = file_hash(api_archive)
    if api_checksum != archive_sha:
        raise ValueError('Existing API archive does not match its recorded SHA-256')
    seed_root = root / 'workspace-artifacts' / 'education-video-seed-20260910'
    observed, all_entries = {}, set()
    with tarfile.open(api_archive, mode='r|gz') as archive:
        for member in archive:
            name = VERIFY['safe_name'](member.name)
            if name in all_entries or name.split('/')[0] not in {'src', 'media-seed', 'package.json', 'package-lock.json'}:
                raise ValueError('Unexpected or duplicate API archive entry')
            all_entries.add(name)
            if member.isdir():
                continue
            if not member.isfile() or name not in expected:
                raise ValueError('Unlisted, linked or special API archive file: ' + name)
            with archive.extractfile(member) as stream:
                checksum = VERIFY['digest'](stream).upper()
            item = expected[name]
            if member.size != item['Bytes'] or checksum != item['SHA256'].upper():
                raise ValueError('Existing API archive differs from inventory: ' + name)
            source = VERIFY['source_file'](seed_root, name[11:]) if name.startswith('media-seed/') else VERIFY['source_file'](root / 'server', name)
            if source.stat().st_size != member.size or file_hash(source) != checksum:
                raise ValueError('Current original source differs from existing archive: ' + name)
            observed[name] = {'Path': name, 'Bytes': member.size, 'SHA256': checksum}
    if set(observed) != set(expected):
        raise ValueError('Existing API archive omits inventoried files')
    api_sources = {name for name in observed if name.startswith('src/')}
    current_sources = {file.relative_to(root / 'server').as_posix() for file in (root / 'server' / 'src').rglob('*') if file.is_file()}
    if api_sources != current_sources or 'src/mediaFileOperations.js' not in api_sources:
        raise ValueError('API archive source list differs from current server')
    # verification.json is an authoring report, not a runtime seed payload.
    current_seed = {'media-seed/manifest.json'} | {'media-seed/' + file.relative_to(seed_root).as_posix() for file in (seed_root / 'files').rglob('*') if file.is_file()}
    if {name for name in observed if name.startswith('media-seed/')} != current_seed:
        raise ValueError('API archive seed list differs from original reviewed seed')
    if observed['media-seed/manifest.json']['SHA256'] != VERIFY['SEED_SHA256']:
        raise ValueError('API archive does not contain the approved education manifest')
    manifest = VERIFY['read_json']((seed_root / 'manifest.json').read_bytes())
    seed_files = {name for name in observed if name.startswith('media-seed/files/')}
    if len(seed_files) != 57 or len(manifest.get('items', [])) != 57 or sum(item.get('equipmentId') is not None for item in manifest['items']) != 54:
        raise ValueError('Expected 57 files and 54 bilingual bindings')
    for item in manifest['items']:
        stored = observed.get('media-seed/files/' + VERIFY['safe_name'](item['fileName']))
        if not stored or stored['SHA256'] != item['sha256'].upper() or stored['Bytes'] != item['size']:
            raise ValueError('Archived seed bytes differ from their reviewed manifest')
    result = {
        'mode': 'verify-api', 'readOnly': True, 'archivePath': str(api_archive),
        'archiveBytes': api_archive.stat().st_size, 'archiveSHA256': archive_sha,
        'apiSourceFilesVerified': len(api_sources), 'apiAndSeedFilesVerified': len(observed),
        'seedFilesVerified': len(seed_files), 'reviewedBilingualBindings': 54,
        'apiExpandedBytes': sum(item['Bytes'] for item in observed.values()),
        'currentOriginalSourcesMatch': True,
        'redundantGeneratedApiStage': str(stage / 'api'),
        'redundantApiStageMayBeRemoved': True,
        'noFilesRemoved': True,
    }
    return result, observed


def write_json(target, value):
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def require_space(directory, additional_bytes):
    free = shutil.disk_usage(directory).free
    if free < additional_bytes + RESERVE_BYTES:
        raise ValueError(f'Insufficient local space: {free} available; {additional_bytes + RESERVE_BYTES} required including 64 MiB reserve')


def finalize(project_root, stage_root):
    root, stage, package_stage = paths(project_root, stage_root)
    api_result, api_inventory = verify_existing_api(root, stage)
    output = root / 'deploy' / '2026-09-10' / PACKAGE_NAME
    partial = stage / (PACKAGE_NAME + '.partial')
    if output.exists() or partial.exists():
        raise ValueError('Existing output or partial archive will not be overwritten')
    if output.parent.resolve() != output.parent or output.parent.stat().st_dev != stage.stat().st_dev:
        raise ValueError('Output and this task stage must be unlinked directories on the same filesystem')
    web_root = root / 'workspace-artifacts' / 'exports' / 'file-explorer-video-20260910'
    VERIFY['source_file'](web_root, 'index.html')
    web_files = sorted(file.relative_to(web_root).as_posix() for file in web_root.rglob('*') if file.is_file())
    for name in web_files:
        VERIFY['source_file'](web_root, name)
    originals = [(name, root / 'scripts') for name in HELPERS] + [(INSTALLER, root / 'deploy' / '2026-09-10')] + [(name, root / 'docs') for name in REPORTS]
    for name, base in originals:
        VERIFY['source_file'](base, name)
    web_bytes = sum((web_root / name).stat().st_size for name in web_files)
    web_archive = package_stage / WEB_NAME
    web_partial = package_stage / (WEB_NAME + '.partial')
    if web_partial.exists() or web_archive.is_symlink():
        raise ValueError('Unexpected existing partial or linked staged Web archive')
    # This is the one permitted removal: an obsolete generated Web archive in
    # the exact task-owned stage, never a previously delivered deployment ZIP.
    reclaimable = web_archive.stat().st_size if web_archive.exists() else 0
    require_space(stage, max(0, web_bytes + 1024 ** 2 - reclaimable))
    if web_archive.exists():
        web_archive.unlink()
    try:
        with zipfile.ZipFile(web_partial, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in web_files:
                archive.write(VERIFY['source_file'](web_root, name), name)
        web_partial.rename(web_archive)
    except BaseException:
        if web_partial.exists():
            web_partial.unlink()
        raise
    # Validate new ZIP contents against current export before packaging it.
    with zipfile.ZipFile(web_archive) as archive:
        entries = VERIFY['zip_entries'](archive)
        if set(entries) != set(web_files):
            raise ValueError('Rebuilt Web archive file list differs from export')
        for name, member in entries.items():
            with archive.open(member) as compressed, VERIFY['source_file'](web_root, name).open('rb') as source:
                if VERIFY['digest'](compressed) != VERIFY['digest'](source):
                    raise ValueError('Web source changed during rebuilding: ' + name)
        web_bytes = sum(member.file_size for member in entries.values())
    for name, base in originals:
        shutil.copyfile(VERIFY['source_file'](base, name), package_stage / name)
    sizes = {
        'version': 1, 'apiArchive': API_NAME, 'webArchive': WEB_NAME,
        'apiArchiveBytes': api_result['archiveBytes'], 'webArchiveBytes': web_archive.stat().st_size,
        'apiExpandedBytes': api_result['apiExpandedBytes'], 'webExpandedBytes': web_bytes,
    }
    write_json(package_stage / 'deployment-sizes.json', sizes)
    write_json(package_stage / 'build-inventory.json', {
        'ApiAndSeedFiles': list(api_inventory.values()), 'SeedImportId': 'education-videos-20260910',
        'SeedFiles': 57, 'ReviewedVideoBindings': 54, 'WebExport': str(web_root),
        'ResumeMode': 'Existing API archive verified byte-for-byte before reuse',
    })
    runtime_names = [API_NAME, WEB_NAME, 'deployment-sizes.json', *HELPERS]
    (package_stage / 'runtime-checksums.sha256').write_text(''.join(f'{file_hash(package_stage / name).lower()}  {name}\n' for name in runtime_names), encoding='ascii')
    package_names = [API_NAME, WEB_NAME, INSTALLER, *HELPERS, *REPORTS, 'deployment-sizes.json', 'runtime-checksums.sha256', 'build-inventory.json']
    require_space(stage, sum((package_stage / name).stat().st_size for name in package_names) + 1024 ** 2)
    published = False
    try:
        with zipfile.ZipFile(partial, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name in package_names:
                archive.write(VERIFY['source_file'](package_stage, name), name)
        # The complete nested read-only verifier must pass before publication.
        with contextlib.redirect_stdout(io.StringIO()):
            result = VERIFY['main'](partial, root)
        # A hard-link publish is atomic and refuses an existing destination on
        # both Windows and Linux; no second copy or overwrite is possible.
        os.link(partial, output)
        published = True
        partial.unlink()
        result['path'] = str(output)
        result['mode'] = 'finalize'
        result['existingApiArchiveReusedAfterFullVerification'] = True
        result['obsoleteTaskStagedWebArchiveRebuilt'] = bool(reclaimable)
        print(json.dumps(result, ensure_ascii=False))
        return result
    finally:
        if not published and partial.exists():
            partial.unlink()


if __name__ == '__main__':
    if len(sys.argv) != 4 or sys.argv[1] not in ('verify-api', 'finalize'):
        raise SystemExit('Usage: finalize-file-explorer-low-space.py verify-api|finalize PROJECT_ROOT TASK_STAGE')
    if sys.argv[1] == 'verify-api':
        report, _ = verify_existing_api(sys.argv[2], sys.argv[3])
        print(json.dumps(report, ensure_ascii=False))
    else:
        finalize(sys.argv[2], sys.argv[3])
