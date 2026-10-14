"""Seal the web-only goal/audio release over verified installed v26; never deploy."""
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
PREFIX = 'outdoor-fit-goal-audio-20261014-v28'
SUPPORT = ROOT / 'deploy/goal-audio-20261014-v28'
WEB_ROOT = ROOT / 'workspace-artifacts/goal-audio-20261014-v28-web'
WEB = WEB_ROOT / 'export'
STAGE = ROOT / 'workspace-artifacts/goal-audio-20261014-v28' / PREFIX
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
        manifest = json.load(tar.extractfile(name + '/manifest.json'))
        for path, value in manifest['files'].items():
            need(digest(tar.extractfile(name + '/' + path).read()) == value, 'BASELINE_PAYLOAD_CHANGED')
    return manifest


def baselines():
    prior = sealed_manifest('exercise-video-categories-20261012-v26',
                            'outdoor-fit-exercise-video-categories-20261012-v26')
    need(prior['release'] == 'outdoor-fit-exercise-video-categories-20261012-v26'
         and prior['version'] == 2 and len(prior['baselines']) == 24, 'V26_BASELINE_CHANGED')
    overlay = {name: value for name, value in prior['files'].items() if name.startswith('server/src/')}
    api = None
    webs = {}
    for name, row in prior['baselines'].items():
        installed_api = {**{n: h for n, h in row['sourceFiles'].items() if n.startswith('server/src/')}, **overlay}
        need(all(isinstance(h, str) and len(h) == 64 for h in installed_api.values()), 'V26_API_INCOMPLETE')
        need(api is None or api == installed_api, 'V26_API_BASELINE_CONFLICT')
        api = installed_api
        # v26 copies its entire predecessor tree, then overlays its web delta.
        # Hashed historical assets remain present and are part of the live inventory.
        webs['v26-from-' + name] = {**row['webFiles'], **prior['webFiles']}
    need(len(api) == 27 and len(webs) == 24, 'V26_INSTALLED_BASELINE_CHANGED')
    return api, webs


def verify_frozen_sources():
    source = ROOT / 'workspace-artifacts/goal-audio-20261014-qa/source-manifest.json'
    for row in json.loads(source.read_text(encoding='utf-8')):
        need(digest((ROOT / row['path']).read_bytes()) == row['sha256'], 'QA_SOURCE_CHANGED')


def verify_web():
    result = subprocess.run(['node', str(ROOT / 'scripts/goal-audio-web-release-manifest-v28.cjs'), 'verify'],
                            cwd=ROOT, capture_output=True, text=True)
    need(result.returncode == 0, 'WEB_SEAL_VERIFY_FAILED')
    verify_frozen_sources()


def main():
    need(not OUT.exists() and not STAGE.exists(), 'PACKAGE_ALREADY_EXISTS')
    verify_web()
    required_api, known = baselines()
    spec = importlib.util.spec_from_file_location('goal_audio_installer', SUPPORT / 'install.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    need(required_api == module.REQUIRED_API_SOURCE, 'V26_API_HASH_MISMATCH')
    need({name: module.web_digest(files) for name, files in known.items()} == module.BASELINE_WEB_DIGESTS,
         'V26_WEB_BASELINE_HASH_MISMATCH')
    web_files = module.inventory(WEB, 'web/')
    sealed_web = json.loads((WEB_ROOT / 'release-manifest.json').read_text(encoding='utf-8'))
    need(web_files == {'web/' + k: v['sha256'] for k, v in sealed_web['files'].items()}, 'WEB_SEAL_HASH_MISMATCH')
    payload = {name: SUPPORT / name for name in module.SUPPORT}
    payload.update({name: WEB / name.removeprefix('web/') for name, value in web_files.items()
                    if any(baseline.get(name) != value for baseline in known.values())})
    for name, file in payload.items():
        module.safe_name(name)
        need(file.is_file() and not file.is_symlink(), 'SOURCE_FILE_INVALID')
    hashes = {name: digest(file.read_bytes()) for name, file in sorted(payload.items())}
    manifest = {'version': 1, 'release': PREFIX, 'files': hashes,
                'requiredApiSourceFiles': required_api,
                'baselines': {name: {'webFiles': files} for name, files in known.items()}, 'webFiles': web_files}
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
            info.mtime = 1791936000
            archive.addfile(info, io.BytesIO(data))
    with tarfile.open(OUT, 'r:gz') as archive:
        for name, value in hashes.items():
            need(digest(archive.extractfile(PREFIX + '/' + name).read()) == value, 'ARCHIVE_VERIFY_FAILED')
    need(all(digest(file.read_bytes()) == hashes[name] for name, file in payload.items()), 'SOURCE_CHANGED_DURING_PACKAGING')
    verify_web()
    final = {'path': str(OUT), 'bytes': OUT.stat().st_size, 'sha256': digest(OUT.read_bytes()),
             'payloadFiles': len(hashes), 'webChangedFiles': sum(name.startswith('web/') for name in hashes),
             'webTotalFiles': len(web_files), 'baselineCount': len(known), 'requiredBackend': 'v26', 'remoteUpdated': False}
    (SUPPORT / 'SHA256SUMS').write_text(final['sha256'] + '  ' + OUT.name + '\n', encoding='ascii')
    (STAGE.parent / 'package-result.json').write_text(json.dumps(final, indent=2), encoding='utf-8')
    print(json.dumps(final, ensure_ascii=True))


if __name__ == '__main__':
    main()
