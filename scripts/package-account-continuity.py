"""Seal the v9 server/web delivery after the frontend export and tests."""
from pathlib import Path
import hashlib, json, tarfile, io, importlib.util
ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'outdoor-fit-account-continuity-20260928-v9'
OUT = ROOT / 'deploy/account-continuity-20260928' / (PREFIX + '-delta.tar.gz')
WEB = ROOT / 'workspace-artifacts/account-continuity-20260928-v9-web'
SUPPORT = ROOT / 'deploy/account-continuity-20260928'

def main():
    assert not OUT.exists(), 'PACKAGE_ALREADY_SEALED'
    assert (WEB / 'index.html').is_file(), 'WEB_EXPORT_REQUIRED'
    files = {}
    spec = importlib.util.spec_from_file_location('baseline', ROOT / 'scripts/package-aliyun-equipment-image-cleanup-v4.py')
    baseline_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(baseline_module)
    baseline, _ = baseline_module.read_baseline()
    web_files = {}
    for base, prefix in [(ROOT / 'server/src', 'server/src'), (WEB, 'web')]:
        for path in base.rglob('*'):
            assert not path.is_symlink(), 'PACKAGE_LINK_REFUSED'
            if path.is_file():
                name = prefix + '/' + path.relative_to(base).as_posix()
                assert not path.name.startswith('.env') and path.suffix not in ['.pem','.sqlite','.db','.key'], 'PRIVATE_FILE_REFUSED'
                if prefix == 'web':
                    web_files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
                    if baseline.get(name, {}).get('sha256') == web_files[name]: continue
                files[name] = path
    for name in ['Dockerfile','Dockerfile.dockerignore','schema.sql','migrate.mjs','install.py','README.md']:
        files[name] = SUPPORT / name
    records = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sorted(files.items())}
    manifest = json.dumps({'release':PREFIX,'files':records,'webFiles':web_files},indent=2).encode() + b'\n'
    with OUT.open('xb') as output, tarfile.open(fileobj=output,mode='w:gz') as archive:
        for name,path in sorted(files.items()):
            content = path.read_bytes(); assert hashlib.sha256(content).hexdigest()==records[name], 'SOURCE_CHANGED'
            item = tarfile.TarInfo(PREFIX+'/'+name); item.size=len(content); item.mode=0o644
            archive.addfile(item,io.BytesIO(content))
        item=tarfile.TarInfo(PREFIX+'/manifest.json');item.size=len(manifest);item.mode=0o644
        archive.addfile(item,io.BytesIO(manifest))
    with tarfile.open(OUT,'r:gz') as archive:
        for name,expected in records.items(): assert hashlib.sha256(archive.extractfile(PREFIX+'/'+name).read()).hexdigest()==expected
    sha=hashlib.sha256(OUT.read_bytes()).hexdigest()
    (SUPPORT/'SHA256SUMS').write_text(sha+'  '+OUT.name+'\n',encoding='ascii')
    print('PACKAGE_FILE='+str(OUT)); print('PACKAGE_BYTES='+str(OUT.stat().st_size));print('SHA256='+sha);print('PACKAGE_VERIFIED=PASS')
if __name__=='__main__': main()
