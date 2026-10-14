"""Seal a small FAQ/backend/web delta; never connect to or modify a server."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tarfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
PREFIX = 'outdoor-fit-ai-faq-20261006-v15'
SUPPORT = ROOT/'deploy/ai-faq-20261006-v15'
WEB = ROOT/'workspace-artifacts/ai-faq-load-20261006/web-final'
STAGE = ROOT/'workspace-artifacts/ai-faq-load-20261006'/PREFIX
OUT = SUPPORT/(PREFIX+'.tar.gz')
BASELINE = ROOT/'deploy/video-capacity-20261003-v14/outdoor-fit-video-capacity-20261003-v14-delta.tar.gz'

def digest(data): return hashlib.sha256(data).hexdigest()
def need(ok, code):
    if not ok: raise RuntimeError(code)

def main():
    need(not OUT.exists() and not STAGE.exists(), 'PACKAGE_ALREADY_EXISTS')
    expected_baseline = (ROOT/'deploy/video-capacity-20261003-v14/SHA256SUMS').read_text().split()[0]
    need(digest(BASELINE.read_bytes()) == expected_baseline, 'BASELINE_ARCHIVE_CHANGED')
    with tarfile.open(BASELINE, 'r:gz') as tar:
        baseline = json.load(tar.extractfile('outdoor-fit-video-capacity-20261003-v14/manifest.json'))
    spec = importlib.util.spec_from_file_location('ai_faq_installer', SUPPORT/'install.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    source_hashes = {**baseline['baselineSourceFiles'], **{k:v for k,v in baseline['files'].items() if k.startswith('server/src/')}}
    need(all(source_hashes.get(k)==v for k,v in module.BASELINE_SOURCE.items()), 'BASELINE_SOURCE_HASH_MISMATCH')
    baseline_web = baseline['webFiles']
    web_files = module.inventory(WEB, 'web/')
    # Only the FAQ integration changed in the existing front-end source tree.
    old_sources = json.loads((ROOT/'workspace-artifacts/video-capacity-20261003-v14-web/release-manifest.json').read_text(encoding='utf-8'))['sourceFiles']
    changed = {k for k,v in old_sources.items() if digest((ROOT/k).read_bytes()) != v['sha256']}
    need(changed == {'app/(tabs)/chat/index.js','utils/assistantEquipmentSearch.js'}, 'UNRELATED_CLIENT_CHANGES_REQUIRE_REVIEW')
    payload = {name:ROOT/name for name in module.BASELINE_SOURCE}
    payload.update({name:SUPPORT/name for name in module.SUPPORT})
    payload.update({name:WEB/name.removeprefix('web/') for name,value in web_files.items() if baseline_web.get(name)!=value})
    for name, file in payload.items():
        module.safe_name(name)
        need(file.is_file() and not file.is_symlink(), 'SOURCE_FILE_INVALID')
    hashes = {name:digest(file.read_bytes()) for name,file in sorted(payload.items())}
    manifest = {'version':1,'release':PREFIX,'files':hashes,'baselineSourceFiles':module.BASELINE_SOURCE,
                'baselineWebFiles':baseline_web,'webFiles':web_files}
    STAGE.mkdir()
    for name,file in payload.items():
        target=STAGE/name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(file,target)
    (STAGE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    module.verify_package(STAGE)
    with OUT.open('xb') as output, tarfile.open(fileobj=output,mode='w:gz') as archive:
        for name in sorted([*hashes,'manifest.json']):
            data=(STAGE/name).read_bytes()
            info=tarfile.TarInfo(PREFIX+'/'+name)
            info.size=len(data);info.mode=0o644;info.uid=0;info.gid=0;info.mtime=1791244800
            archive.addfile(info,io.BytesIO(data))
    with tarfile.open(OUT,'r:gz') as archive:
        for name,value in hashes.items():
            need(digest(archive.extractfile(PREFIX+'/'+name).read())==value,'ARCHIVE_VERIFY_FAILED')
    need(all(digest(p.read_bytes())==hashes[n] for n,p in payload.items()),'SOURCE_CHANGED_DURING_PACKAGING')
    final = {'path':str(OUT),'bytes':OUT.stat().st_size,'sha256':digest(OUT.read_bytes()),
             'payloadFiles':len(hashes),'webChangedFiles':sum(n.startswith('web/') for n in hashes),'webTotalFiles':len(web_files),'remoteUpdated':False}
    (SUPPORT/'SHA256SUMS').write_text(final['sha256']+'  '+OUT.name+'\n',encoding='ascii')
    (ROOT/'workspace-artifacts/ai-faq-load-20261006/package-result.json').write_text(json.dumps(final,indent=2),encoding='utf-8')
    print(json.dumps(final,ensure_ascii=True))

if __name__ == '__main__': main()
