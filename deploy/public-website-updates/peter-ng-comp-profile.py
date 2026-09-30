#!/usr/bin/env python3
"""Update only Peter Ng's two homepage profile links; no service restart."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

BASE = Path('/opt/outdoor-fit/production')
EXPECTED_WEB = BASE / 'releases/public-website-20260928-v1/website'
CADDY = 'outdoor-fit-production-caddy-1'
OLD_URL = b'https://www.polyu.edu.hk/rs/people/academic-staff/prof-peter-ng/'
NEW_URL = b'https://www.polyu.edu.hk/comp/people/academic-staff/prof-ng-hiu-fung-peter/'
PERSON = '吳曉峰教授'.encode('utf-8')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def run(args):
    result = subprocess.run(args, capture_output=True, timeout=20)
    require(result.returncode == 0, 'PROFILE_COMMAND_FAILED')
    return result.stdout


def candidate(data):
    """Return unchanged bytes on a repeat run; reject partial/unexpected edits."""
    spans = []
    for anchor in re.finditer(rb'<a\b[^>]*>', data, re.IGNORECASE):
        label = re.search(rb'\baria-label\s*=\s*([\"\x27])(.*?)\1', anchor.group())
        if label is None or not label.group(2).startswith(PERSON + '：'.encode('utf-8')):
            continue
        hrefs = list(re.finditer(rb'\bhref\s*=\s*([\"\x27])(.*?)\1', anchor.group()))
        require(len(hrefs) == 1, 'PROFILE_UNEXPECTED_HREF_MARKUP')
        href = hrefs[0]
        spans.append((anchor.start() + href.start(2), anchor.start() + href.end(2), href.group(2)))
    require(len(spans) == 2, 'PROFILE_EXPECTED_TWO_LINKS')
    values = [span[2] for span in spans]
    if values == [NEW_URL, NEW_URL]:
        return data
    require(values == [OLD_URL, OLD_URL], 'PROFILE_UNEXPECTED_OR_PARTIAL_LINKS')
    result = data
    for start, end, _ in reversed(spans):
        result = result[:start] + NEW_URL + result[end:]
    return result


def atomic_write(path, data, metadata, restore_time=False):
    descriptor, temporary = tempfile.mkstemp(prefix='.peter-profile-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        shutil.copystat(path, temporary, follow_symlinks=False)
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        # Keep access time; a changed Last-Modified value invalidates browser caches.
        os.utime(temporary, ns=(metadata.st_atime_ns,
                               metadata.st_mtime_ns if restore_time else time.time_ns()))
        os.replace(temporary, path)
        if hasattr(os, 'O_DIRECTORY'):
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def update(path, backup_parent, verify):
    require(path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1,
            'PROFILE_INDEX_NOT_REGULAR')
    metadata = path.stat()
    before = path.read_bytes()
    after = candidate(before)
    if after == before:
        verify(after)
        print('PROFILE_UPDATE=ALREADY_CURRENT')
        return
    require(backup_parent.is_dir() and not backup_parent.is_symlink(), 'PROFILE_BACKUP_PARENT_INVALID')
    backup = Path(tempfile.mkdtemp(prefix='peter-ng-comp-profile-', dir=backup_parent))
    backup.chmod(0o700)
    saved = backup / 'index.html.before'
    saved.write_bytes(before)
    saved.chmod(0o600)
    print('PROFILE_BACKUP=' + str(saved), flush=True)
    require(path.read_bytes() == before and path.stat().st_ino == metadata.st_ino,
            'PROFILE_INDEX_CHANGED_CONCURRENTLY')
    atomic_write(path, after, metadata)
    try:
        require(path.read_bytes() == after, 'PROFILE_WRITE_VERIFICATION_FAILED')
        verify(after)
    except BaseException:
        if path.read_bytes() == after:
            atomic_write(path, before, metadata, restore_time=True)
            print('PROFILE_ROLLBACK=COMPLETE', flush=True)
        else:
            print('PROFILE_ROLLBACK=STOPPED_CONCURRENT_EDIT', flush=True)
        raise
    print('PROFILE_CHANGED_HREFS=2\nPROFILE_SERVED_INDEX=PASS\nPROFILE_UPDATE=PASS', flush=True)


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0, 'PROFILE_ROOT_REQUIRED')
    require(EXPECTED_WEB.is_dir() and EXPECTED_WEB.resolve() == EXPECTED_WEB,
            'PROFILE_RELEASE_PATH_CHANGED')
    live = json.loads(run(['docker', 'inspect', CADDY]))[0]
    require(live['State']['Running'], 'PROFILE_CADDY_NOT_RUNNING')
    mounts = [item for item in live['Mounts'] if item['Destination'] == '/srv/website']
    require(len(mounts) == 1 and mounts[0]['Type'] == 'bind'
            and mounts[0]['Source'] == str(EXPECTED_WEB) and mounts[0]['RW'] is False,
            'PROFILE_WEBSITE_MOUNT_CHANGED')

    def verify(expected):
        served = run(['docker', 'exec', CADDY, 'wget', '-q', '-O', '-',
                      '--header=Host: outdoorfit.hk', 'http://127.0.0.1:8099/'])
        require(hashlib.sha256(served).digest() == hashlib.sha256(expected).digest(),
                'PROFILE_SERVED_INDEX_MISMATCH')

    with (BASE / '.public-website.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        update(EXPECTED_WEB / 'index.html', BASE / '.update-state', verify)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        print('PROFILE_UPDATE_FAILED_NO_SECRETS_LOGGED', file=sys.stderr)
        sys.exit(1)
