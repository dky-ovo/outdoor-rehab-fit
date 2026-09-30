#!/usr/bin/env python3
"""Apply staged maintenance, drain requests and stop the Google source writer."""
import fcntl
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

SITE = Path('/etc/nginx/sites-available/outdoor-fit')
MAIN = Path('/etc/nginx/nginx.conf')
ENABLED = Path('/etc/nginx/sites-enabled/outdoor-fit')
HOST = 'outdoor-fit.35-241-75-217.sslip.io'
APP = Path('/home/dukaiyu2004/outdoor-fit-api')
SERVICE = 'outdoor-fit-api'
EXPECTED = {str(MAIN), str(ENABLED), '/etc/nginx/mime.types',
            '/etc/letsencrypt/options-ssl-nginx.conf'}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(args, timeout=30):
    return subprocess.run(args, capture_output=True, timeout=timeout)


def prop(unit, name):
    result = run(['systemctl', 'show', unit, '--property=' + name, '--value'])
    require(result.returncode == 0, 'SERVICE_STATUS_UNAVAILABLE')
    return result.stdout.decode('utf-8').strip()


def checked_file(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
            and not info.st_mode & 0o022, 'CUTOVER_FILE_INVALID')
    return path.read_bytes()


def identity(pid):
    try:
        fields = Path('/proc/{}/stat'.format(pid)).read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return None
        return pid, fields[19]
    except FileNotFoundError:
        return None


def workers(master):
    result = {}
    children = Path('/proc/{0}/task/{0}/children'.format(master)).read_text().split()
    for value in children:
        pid = int(value)
        try:
            title = Path('/proc/{}/cmdline'.format(pid)).read_bytes()
        except FileNotFoundError:
            continue
        token = identity(pid)
        if token and title.startswith(b'nginx: worker process'):
            result[token] = b'is shutting down' in title
    return result


def install(data, expected, info):
    require(SITE.read_bytes() == expected and not SITE.is_symlink(), 'LIVE_CONFIG_CHANGED')
    fd, filename = tempfile.mkstemp(prefix='.outdoor-fit-switch-', dir=str(SITE.parent))
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            os.fsync(stream.fileno())
        require(SITE.read_bytes() == expected, 'LIVE_CONFIG_CHANGED')
        os.replace(filename, SITE)
        directory = os.open(str(SITE.parent), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def maintenance_responds():
    for route in ['/api/health', '/api/admin/media/upload']:
        result = run(['curl', '--silent', '--show-error', '--noproxy', '*',
                      '--connect-timeout', '3', '--max-time', '8',
                      '--resolve', HOST + ':443:127.0.0.1',
                      '--output', '/dev/null', '--write-out', '%{http_code}',
                      'https://' + HOST + route], timeout=12)
        if result.returncode != 0 or result.stdout.strip() != b'503':
            return False
    return True


def no_open_source_files():
    database = str(APP / 'data/outdoor-fit.sqlite')
    trees = [str(APP / value) + '/' for value in
             ['data/equipment-images', 'data/media-library', 'media-seed']]
    holders = set()
    for process in Path('/proc').iterdir():
        if not process.name.isdigit() or int(process.name) == os.getpid():
            continue
        try:
            for fd in (process / 'fd').iterdir():
                try:
                    target = os.readlink(fd)
                    if target.endswith(' (deleted)'):
                        target = target[:-10]
                except FileNotFoundError:
                    continue
                if target in [database, database + '-wal', database + '-shm'] or any(target.startswith(tree) for tree in trees):
                    holders.add(process.name)
        except FileNotFoundError:
            continue
    if holders:
        print('SOURCE_OPEN_FILE_PIDS=' + ','.join(sorted(holders)), flush=True)
    require(not holders, 'SOURCE_FILES_STILL_OPEN')


def main():
    require(os.geteuid() == 0, 'FREEZE_REQUIRES_ROOT')
    require(len(sys.argv) == 2, 'CUTOVER_DIR_REQUIRED')
    require(shutil.which('curl') is not None, 'CURL_REQUIRED')
    folder = Path(sys.argv[1])
    require(re.fullmatch(r'/home/dukaiyu2004/outdoor-fit-cutover-[a-z0-9_]+', str(folder)), 'CUTOVER_DIR_INVALID')
    info = folder.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, 'CUTOVER_DIR_INVALID')
    os.umask(0o077)
    lock = (folder / 'freeze.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    manifest = json.loads(checked_file(folder / 'manifest.json'))
    require(manifest['source'] == str(SITE) and ENABLED.resolve(strict=True) == SITE
            and not SITE.is_symlink(), 'SITE_PATH_CHANGED')
    files = {name: checked_file(folder / name) for name in
             ['original.conf', 'maintenance.conf', 'aliyun.conf']}
    require(all(digest(value) == manifest['files'][name] for name, value in files.items())
            and digest(files['original.conf']) == manifest['source_sha256'], 'CANDIDATE_HASH_CHANGED')
    require(digest(MAIN.read_bytes()) == manifest['main_sha256'], 'MAIN_CONFIG_CHANGED')
    previous = SITE.read_bytes()
    require(previous in [files['original.conf'], files['maintenance.conf']], 'LIVE_CONFIG_NOT_ORIGINAL_OR_MAINTENANCE')
    probe = run(['nginx', '-T'])
    require(probe.returncode == 0, 'CURRENT_NGINX_CONFIG_INVALID')
    active = set(re.findall(r'(?m)^# configuration file (/[^\r\n]+):\r?$', probe.stdout.decode('utf-8')))
    require(active == EXPECTED, 'ACTIVE_NGINX_FILES_CHANGED')
    require(prop(SERVICE, 'ActiveState') in ['active', 'inactive'], 'SOURCE_SERVICE_STATE_UNEXPECTED')
    require(not prop(SERVICE, 'TriggeredBy').strip(), 'SOURCE_SERVICE_HAS_OTHER_TRIGGERS')
    before_file = folder / 'source-service-before.json'
    if not before_file.exists():
        before = {key: prop(SERVICE, key) for key in ['ActiveState', 'MainPID', 'UnitFileState']}
        with before_file.open('x', encoding='utf-8') as stream:
            json.dump(before, stream)
            stream.flush()
            os.fsync(stream.fileno())
    master = int(prop('nginx', 'MainPID'))
    master_token = identity(master)
    require(master > 1 and master_token, 'NGINX_MASTER_UNAVAILABLE')
    old_workers = set(workers(master))
    require(old_workers, 'NGINX_WORKERS_UNAVAILABLE')
    site_info = SITE.stat()
    print('ENTERING_MAINTENANCE', flush=True)
    install(files['maintenance.conf'], previous, site_info)
    try:
        require(run(['nginx', '-t']).returncode == 0, 'MAINTENANCE_NGINX_CHECK_FAILED')
        require(run(['systemctl', 'reload', 'nginx']).returncode == 0, 'MAINTENANCE_RELOAD_FAILED')
    except BaseException:
        if SITE.read_bytes() == files['maintenance.conf']:
            install(previous, files['maintenance.conf'], site_info)
            valid = run(['nginx', '-t']).returncode == 0
            restored = valid and run(['systemctl', 'reload', 'nginx']).returncode == 0
            print('PREVIOUS_CONFIG_RESTORED=' + ('YES' if restored else 'REVIEW_REQUIRED'), flush=True)
        raise
    deadline = time.monotonic() + 600
    last_report = 0
    while True:
        require(identity(master) == master_token, 'NGINX_MASTER_CHANGED')
        remaining = {token for token in old_workers if identity(token[0]) == token}
        draining = {token for token, stopping in workers(master).items() if stopping}
        if not remaining and not draining and maintenance_responds():
            break
        require(time.monotonic() < deadline, 'DRAIN_TIMEOUT_KEEP_MAINTENANCE')
        if time.monotonic() - last_report >= 15:
            print('WAITING_FOR_INFLIGHT_REQUESTS=' + str(len(remaining | draining)), flush=True)
            last_report = time.monotonic()
        time.sleep(2)
    print('API_MAINTENANCE=503', flush=True)
    print('INFLIGHT_REQUESTS=DRAINED', flush=True)
    require(SITE.read_bytes() == files['maintenance.conf'], 'LIVE_CONFIG_CHANGED')
    require(run(['systemctl', 'stop', SERVICE], timeout=180).returncode == 0, 'SOURCE_STOP_FAILED')
    require(prop(SERVICE, 'ActiveState') == 'inactive' and prop(SERVICE, 'MainPID') == '0', 'SOURCE_NOT_STOPPED')
    require(run(['systemctl', 'disable', SERVICE]).returncode == 0, 'SOURCE_DISABLE_FAILED')
    require(prop(SERVICE, 'UnitFileState') in ['disabled', 'masked', 'masked-runtime'], 'SOURCE_AUTOSTART_NOT_DISABLED')
    no_open_source_files()
    print('SOURCE_ACTIVE_STATE=inactive', flush=True)
    print('SOURCE_MAIN_PID=0', flush=True)
    print('SOURCE_AUTOSTART=DISABLED', flush=True)
    print('SOURCE_OPEN_FILES=0', flush=True)
    print('SOURCE_FREEZE=COMPLETE', flush=True)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Z0-9_]+', str(error)) else type(error).__name__.upper()
        print('SOURCE_FREEZE=FAILED', flush=True)
        print('ERROR_CODE=' + code, flush=True)
        print('SOURCE_NOT_AUTOMATICALLY_RESTARTED', flush=True)
        sys.exit(1)
