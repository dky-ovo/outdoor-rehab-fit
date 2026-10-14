"""Seal the provider-switch delta for exact v20/v21 source/web pairs; never deploy."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'outdoor-fit-ai-providers-20261008-v22'
SUPPORT = ROOT / 'deploy/ai-providers-20261008-v22'
WEB_ROOT = ROOT / 'workspace-artifacts/ai-providers-20261008-v22-web'
WEB = WEB_ROOT / 'export'
STAGE = ROOT / 'workspace-artifacts/ai-providers-20261008-v22' / PREFIX
OUT = SUPPORT / (PREFIX + '.tar.gz')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def need(ok, code):
    if not ok:
        raise RuntimeError(code)


def sealed_manifest(folder, name):
    archive = ROOT / 'deploy' / folder / (name + '.tar.gz')
    checksum = (archive.parent / 'SHA256SUMS').read_text(encoding='ascii').split()
    need(len(checksum) == 2 and checksum[1] == archive.name and digest(archive.read_bytes()) == checksum[0],
         'BASELINE_ARCHIVE_CHANGED')
    with tarfile.open(archive, 'r:gz') as tar:
        return json.load(tar.extractfile(name.removesuffix('-delta') + '/manifest.json'))


def baselines():
    v20 = sealed_manifest('faq-elderly-20261007-v20', 'outdoor-fit-faq-elderly-20261007-v20')
    v21 = sealed_manifest('faq-repetitions-20261007-v21', 'outdoor-fit-faq-repetitions-20261007-v21')
    v12 = sealed_manifest('app-suggestions-20261002-v12', 'outdoor-fit-app-suggestions-20261002-v12-delta')
    # accountDocuments was shipped in v12 and is absent from every later delta.
    # These immutable predecessor payloads, never the working tree, establish it.
    unchanged = v12['files']['server/src/accountDocuments.js']
    intermediate = [
        ('load-capacity-20261002-v13', 'outdoor-fit-load-capacity-20261002-v13-delta'),
        ('video-capacity-20261003-v14', 'outdoor-fit-video-capacity-20261003-v14-delta'),
        ('ai-faq-20261006-v15', 'outdoor-fit-ai-faq-20261006-v15'),
        ('ai-sync-keyboard-20261006-v16', 'outdoor-fit-ai-sync-keyboard-20261006-v16'),
        ('chat-session-20261006-v17', 'outdoor-fit-chat-session-20261006-v17'),
        ('faq-sync-keyboard-20261007-v18', 'outdoor-fit-faq-sync-keyboard-20261007-v18'),
        ('faq-language-20261007-v19', 'outdoor-fit-faq-language-20261007-v19'),
    ]
    for folder, archive in intermediate:
        previous = sealed_manifest(folder, archive)
        need(previous['files'].get('server/src/accountDocuments.js', unchanged) == unchanged,
             'ACCOUNT_DOCUMENTS_BASELINE_CHANGED')
    result = {}
    for version, release in [('v20', v20), ('v21', v21)]:
        source = {k: v for k, v in release['files'].items() if k.startswith('server/src/')}
        need('server/src/accountDocuments.js' not in source, 'ACCOUNT_DOCUMENTS_BASELINE_CHANGED')
        source['server/src/accountDocuments.js'] = unchanged
        for module in ['assistantProviders', 'assistantBailianChat', 'assistantProviderRoutes',
                       'assistantBailian', 'assistantBailianFaq', 'assistantBailianPolicy']:
            name = 'server/src/' + module + '.js'
            need(name not in source, 'NEW_SOURCE_ALREADY_IN_BASELINE')
            source[name] = None
        for name, row in release['baselines'].items():
            result[version + '-from-' + name] = {
                'sourceFiles': source.copy(), 'webFiles': {**row['webFiles'], **release['webFiles']}}
    return result


def main():
    need(not OUT.exists() and not STAGE.exists(), 'PACKAGE_ALREADY_EXISTS')
    result = subprocess.run(['node', str(ROOT / 'scripts/ai-providers-web-release-manifest-v22.cjs'), 'verify'],
                            cwd=ROOT, capture_output=True, text=True)
    need(result.returncode == 0, 'WEB_SEAL_VERIFY_FAILED')
    known = baselines()
    spec = importlib.util.spec_from_file_location('ai_providers_installer', SUPPORT / 'install.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for name, source in module.BASELINE_SOURCES.items():
        need({k: known[name]['sourceFiles'].get(k) for k in module.UPDATE_SOURCE} == source, 'BASELINE_SOURCE_HASH_MISMATCH')
        need(module.web_digest(known[name]['webFiles']) == module.BASELINE_WEB_DIGESTS[name], 'BASELINE_WEB_HASH_MISMATCH')
        need(all(known[name]['sourceFiles'].get(key) is None for key in module.NEW_SOURCE), 'NEW_SOURCE_ALREADY_IN_BASELINE')
    web_files = module.inventory(WEB, 'web/')
    sealed_web = json.loads((WEB_ROOT / 'release-manifest.json').read_text(encoding='utf-8'))
    need(web_files == {'web/' + k: v['sha256'] for k, v in sealed_web['files'].items()}, 'WEB_SEAL_HASH_MISMATCH')
    payload = {name: ROOT / name for name in module.UPDATE_SOURCE}
    payload.update({name: SUPPORT / name for name in module.SUPPORT})
    payload.update({name: WEB / name.removeprefix('web/') for name, value in web_files.items()
                    if any(baseline['webFiles'].get(name) != value for baseline in known.values())})
    for name, file in payload.items():
        module.safe_name(name)
        need(file.is_file() and not file.is_symlink(), 'SOURCE_FILE_INVALID')
    hashes = {name: digest(file.read_bytes()) for name, file in sorted(payload.items())}
    manifest = {'version': 2, 'release': PREFIX, 'files': hashes,
                'baselines': {name: {'sourceFiles': source, 'webFiles': known[name]['webFiles']}
                              for name, source in module.BASELINE_SOURCES.items()}, 'webFiles': web_files}
    STAGE.mkdir(parents=True)
    for name, file in payload.items():
        target = STAGE / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
    (STAGE / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    module.verify_package(STAGE)
    with OUT.open('xb') as output, tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name in sorted([*hashes, 'manifest.json']):
            data = (STAGE / name).read_bytes()
            info = tarfile.TarInfo(PREFIX + '/' + name)
            info.size = len(data)
            info.mode = 0o644
            info.uid = info.gid = 0
            info.mtime = 1791331200
            archive.addfile(info, io.BytesIO(data))
    with tarfile.open(OUT, 'r:gz') as archive:
        for name, value in hashes.items():
            need(digest(archive.extractfile(PREFIX + '/' + name).read()) == value, 'ARCHIVE_VERIFY_FAILED')
    need(all(digest(file.read_bytes()) == hashes[name] for name, file in payload.items()), 'SOURCE_CHANGED_DURING_PACKAGING')
    verify = subprocess.run(['node', str(ROOT / 'scripts/ai-providers-web-release-manifest-v22.cjs'), 'verify'],
                            cwd=ROOT, capture_output=True, text=True)
    need(verify.returncode == 0, 'WEB_SOURCE_CHANGED_DURING_PACKAGING')
    final = {'path': str(OUT), 'bytes': OUT.stat().st_size, 'sha256': digest(OUT.read_bytes()),
             'payloadFiles': len(hashes), 'webChangedFiles': sum(name.startswith('web/') for name in hashes),
             'webTotalFiles': len(web_files), 'remoteUpdated': False}
    (SUPPORT / 'SHA256SUMS').write_text(final['sha256'] + '  ' + OUT.name + '\n', encoding='ascii')
    (STAGE.parent / 'package-result.json').write_text(json.dumps(final, indent=2), encoding='utf-8')
    print(json.dumps(final, ensure_ascii=True))


if __name__ == '__main__':
    main()
