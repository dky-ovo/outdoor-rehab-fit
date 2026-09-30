"""Package only the public site and reviewed deployment files."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tarfile

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'website'
PACKAGE=ROOT/'deploy/public-website-20260928'
OUT=PACKAGE/'outdoor-fit-public-website-20260928-v1.tar.gz'
subprocess.run([sys.executable,str(ROOT/'scripts/verify-public-website.py')],check=True)
subprocess.run([sys.executable,str(PACKAGE/'build_manifest.py'),'--website',str(SITE),'--output',str(PACKAGE/'website-manifest.json')],check=True)
with tarfile.open(OUT,'w:gz') as archive:
    for name in ['install.py','build_manifest.py','website-manifest.json','README.md']:
        archive.add(PACKAGE/name,arcname='public-website-20260928/'+name)
    for path in sorted(SITE.rglob('*')):
        if path.is_file(): archive.add(path,arcname='public-website-20260928/website/'+path.relative_to(SITE).as_posix(),recursive=False)
sha=hashlib.sha256(OUT.read_bytes()).hexdigest()
(PACKAGE/(OUT.name+'.sha256')).write_text(sha+'  '+OUT.name+'\n',encoding='ascii')
with tarfile.open(OUT,'r:gz') as archive:
    members=archive.getmembers()
    assert all(m.isfile() and not m.name.startswith('/') and '..' not in Path(m.name).parts for m in members)
    payload=json.loads(archive.extractfile('public-website-20260928/website-manifest.json').read())
    for name,entry in payload['files'].items():
        data=archive.extractfile('public-website-20260928/website/'+name).read()
        assert len(data)==entry['bytes'] and hashlib.sha256(data).hexdigest()==entry['sha256']
print('ARCHIVE='+str(OUT))
print('ARCHIVE_BYTES='+str(OUT.stat().st_size))
print('SHA256='+sha)
print('ARCHIVE_VERIFIED=PASS')
