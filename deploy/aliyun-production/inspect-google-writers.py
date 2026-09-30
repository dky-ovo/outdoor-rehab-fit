#!/usr/bin/env python3
"""Show source holders and scheduler metadata without displaying command secrets."""
import os
from pathlib import Path
import re
import subprocess

app = '/home/dukaiyu2004/outdoor-fit-api'
database = app + '/data/outdoor-fit.sqlite'
trees = [app + value for value in ['/data/equipment-images/', '/data/media-library/', '/media-seed/']]
main = int(subprocess.check_output(['systemctl', 'show', 'outdoor-fit-api', '--property=MainPID', '--value'], text=True).strip())
print('SOURCE_MAIN_PID=' + str(main))
family, pending = set(), [main] if main > 0 else []
while pending:
    pid = pending.pop()
    if pid in family:
        continue
    family.add(pid)
    try:
        pending.extend(map(int, Path('/proc/{0}/task/{0}/children'.format(pid)).read_text().split()))
    except FileNotFoundError:
        pass
skipped = 0
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit():
        continue
    found = 0
    try:
        for fd in (proc / 'fd').iterdir():
            try:
                target = os.readlink(fd)
                if target.startswith(database) or any(target.startswith(tree) for tree in trees):
                    found += 1
            except FileNotFoundError:
                pass
    except (FileNotFoundError, ProcessLookupError):
        continue
    except PermissionError:
        skipped += 1
    if found:
        print('SOURCE_HOLDER_PID={} APP_SERVICE={} OPEN_FILES={}'.format(proc.name, 'YES' if int(proc.name) in family else 'NO', found))
print('PROCESS_SCAN_PERMISSION_SKIPS=' + str(skipped))
cron = [Path('/etc/crontab')]
for directory in ['/etc/cron.d', '/var/spool/cron/crontabs', '/etc/cron.hourly', '/etc/cron.daily', '/etc/cron.weekly', '/etc/cron.monthly', '/etc/systemd/system', '/etc/systemd/user', '/home/dukaiyu2004/.config/systemd/user', '/root/.config/systemd/user']:
    root = Path(directory)
    if root.is_dir():
        cron.extend(path for path in root.iterdir() if path.is_file())
for path in sorted(set(cron)):
    if not path.is_file() or path.name.startswith('.'):
        continue
    if 'systemd' in str(path) and path.suffix not in ('.service', '.timer', '.path', '.socket'):
        continue
    text = path.read_text(errors='replace')
    lines = [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    related = bool(re.search(r'outdoor[-_]fit|outdoor-fit\.sqlite|equipment-images|media-library', '\n'.join(lines), re.I))
    print('SCHEDULE_FILE={} ACTIVE_LINES={} APP_REFERENCE={}'.format(path, len(lines), 'YES' if related else 'NO'))
for kind in ['timer', 'service']:
    result = subprocess.run(['systemctl', 'list-units', '--type=' + kind, '--all', '--no-legend', '--plain', '--no-pager'], capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise SystemExit('SYSTEMD_LIST_FAILED')
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) >= 4 and fields[0].endswith('.' + kind) and (kind == 'timer' or fields[3] == 'running'):
            print('SYSTEMD_UNIT={} ACTIVE={} SUB={}'.format(fields[0], fields[2], fields[3]))
print('SOURCE_WRITER_INVENTORY=COMPLETE')
