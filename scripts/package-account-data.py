"""Seal the v10 server/web delivery after the frontend export and tests."""
from pathlib import Path
import hashlib, json, tarfile, io
ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'outdoor-fit-account-data-20260928-v10'
OUT = ROOT / 'deploy/account-data-20260928' / (PREFIX + '-delta.tar.gz')
WEB = ROOT / 'workspace-artifacts/account-data-20260928-v10-web-final'
SUPPORT = ROOT / 'deploy/account-data-20260928'

def main():
    assert not OUT.exists(), 'PACKAGE_ALREADY_SEALED'
    assert (WEB / 'index.html').is_file(), 'WEB_EXPORT_REQUIRED'
    files = {}
    frozen = ROOT / 'deploy/account-continuity-20260928/outdoor-fit-account-continuity-20260928-v9-delta.tar.gz'
    assert hashlib.sha256(frozen.read_bytes()).hexdigest() == 'f5b0b4ea109ab13817122774df17143a4f4af17fe5535a89b2ab2f3fa0fed6be', 'V9_BASELINE_CHANGED'
    with tarfile.open(frozen, 'r:gz') as archive:
        baseline = json.load(archive.extractfile('outdoor-fit-account-continuity-20260928-v9/manifest.json'))['webFiles']
    web_files = {}
    for base, prefix in [(ROOT / 'server/src', 'server/src'), (WEB, 'web')]:
        for path in base.rglob('*'):
            assert not path.is_symlink(), 'PACKAGE_LINK_REFUSED'
            if path.is_file():
                name = prefix + '/' + path.relative_to(base).as_posix()
                assert not path.name.startswith('.env') and path.suffix not in ['.pem','.sqlite','.db','.key'], 'PRIVATE_FILE_REFUSED'
                if prefix == 'web':
                    web_files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
                    if baseline.get(name) == web_files[name]: continue
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
