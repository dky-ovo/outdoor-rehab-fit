"""Seal the web-only exercise-video delta; require the exact sealed v23 API and web; never deploy."""
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
PREFIX = 'outdoor-fit-exercise-video-20261009-v24'
SUPPORT = ROOT / 'deploy/exercise-video-20261009-v24'
WEB_ROOT = ROOT / 'workspace-artifacts/exercise-video-20261009-v24-web'
WEB = WEB_ROOT / 'export'
STAGE = ROOT / 'workspace-artifacts/exercise-video-20261009-v24' / PREFIX
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
    v23 = sealed_manifest('chat-keyboard-20261008-v23', 'outdoor-fit-chat-keyboard-20261008-v23')
    api = {name: checksum for name, checksum in v23['files'].items() if name.startswith('server/src/')}
    need(len(api) == 24 and len(v23['baselines']) == 12, 'V23_BASELINE_CHANGED')
    webs = {}
    for name, row in v23['baselines'].items():
        key = 'v23-from-' + name.split('__', 1)[1].removesuffix('-web')
        merged = {**row['webFiles'], **v23['webFiles']}
        need(key not in webs or webs[key] == merged, 'V23_WEB_BASELINE_CONFLICT')
        webs[key] = merged
    need(len(webs) == 6, 'V23_WEB_BASELINE_CHANGED')
    return api, webs


def main():
    need(not OUT.exists() and not STAGE.exists(), 'PACKAGE_ALREADY_EXISTS')
    result = subprocess.run(['node', str(ROOT / 'scripts/exercise-video-web-release-manifest-v24.cjs'), 'verify'],
                            cwd=ROOT, capture_output=True, text=True)
    need(result.returncode == 0, 'WEB_SEAL_VERIFY_FAILED')
    required_api, known = baselines()
    spec = importlib.util.spec_from_file_location('exercise_video_installer', SUPPORT / 'install.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    need(required_api == module.REQUIRED_API_SOURCE, 'V23_API_HASH_MISMATCH')
    need(set(known) == set(module.BASELINE_WEB_DIGESTS), 'V23_WEB_SET_MISMATCH')
    for name, files in known.items():
        need(module.web_digest(files) == module.BASELINE_WEB_DIGESTS[name], 'V23_WEB_HASH_MISMATCH')
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
            info.mtime = 1791331200
            archive.addfile(info, io.BytesIO(data))
    with tarfile.open(OUT, 'r:gz') as archive:
        for name, value in hashes.items():
            need(digest(archive.extractfile(PREFIX + '/' + name).read()) == value, 'ARCHIVE_VERIFY_FAILED')
    need(all(digest(file.read_bytes()) == hashes[name] for name, file in payload.items()), 'SOURCE_CHANGED_DURING_PACKAGING')
    verify = subprocess.run(['node', str(ROOT / 'scripts/exercise-video-web-release-manifest-v24.cjs'), 'verify'],
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
