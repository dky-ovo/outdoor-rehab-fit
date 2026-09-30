#!/usr/bin/env python3
"""Export only the running Google service's JWT key into a private file."""
import os
from pathlib import Path
import subprocess
import tempfile

if os.geteuid() != 0:
    raise SystemExit("RUN_WITH_SUDO")
app = Path('/home/dukaiyu2004/outdoor-fit-api')
pid = int(subprocess.check_output(
    ['systemctl', 'show', 'outdoor-fit-api', '--property=MainPID', '--value'],
    text=True).strip())
if pid <= 0 or Path('/proc/%s/cwd' % pid).resolve() != app.resolve():
    raise SystemExit('GOOGLE_SERVICE_NOT_RUNNING_AT_EXPECTED_PATH')
items = Path('/proc/%s/environ' % pid).read_bytes().split(b'\0')
values = [item.partition(b'=')[2] for item in items if item.partition(b'=')[0] == b'JWT_SECRET']
if len(values) != 1:
    raise SystemExit('RUNNING_JWT_SECRET_UNAVAILABLE')
secret = values[0]
try:
    valid = len(secret.decode('utf-8')) >= 32
except UnicodeDecodeError:
    valid = False
if not valid or any(char in secret for char in [b'\0', b'\r', b'\n']) or secret == b'development-only-secret-change-before-production':
    raise SystemExit('EXISTING_JWT_NOT_SUITABLE_FOR_PRODUCTION')
os.umask(0o077)
folder = Path(tempfile.mkdtemp(prefix='outdoor-fit-jwt-', dir='/home/dukaiyu2004'))
owner = app.stat()
os.chown(folder, owner.st_uid, owner.st_gid)
output = folder / 'jwt-secret'
with output.open('xb') as stream:
    stream.write(secret)
os.chown(output, owner.st_uid, owner.st_gid)
print('JWT_EXPORT_OK')
print('JWT_FILE=' + str(output))
