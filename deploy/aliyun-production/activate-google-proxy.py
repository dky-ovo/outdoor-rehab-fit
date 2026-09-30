#!/usr/bin/env python3
"""Activate only the staged Aliyun proxy; failures return to maintenance."""
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

CUTOVER = Path('/home/dukaiyu2004/outdoor-fit-cutover-rjxnay1p')
SITE = Path('/etc/nginx/sites-available/outdoor-fit')
ENABLED = Path('/etc/nginx/sites-enabled/outdoor-fit')
MAIN = Path('/etc/nginx/nginx.conf')
HOST = 'outdoor-fit.35-241-75-217.sslip.io'
UPSTREAM = 'api.outdoorfit.hk'
SERVICE = 'outdoor-fit-api'
PUBLIC_CA = Path('/etc/ssl/certs/ca-certificates.crt')
EXPECTED = {str(MAIN), str(ENABLED), '/etc/nginx/mime.types',
            '/etc/letsencrypt/options-ssl-nginx.conf'}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(args, timeout=30):
    return subprocess.run(args, capture_output=True, timeout=timeout)


def checked_file(path):
    descriptor = os.open(str(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                and not info.st_mode & 0o022, 'CONFIG_FILE_INVALID')
        return stream.read()


def source_stopped():
    result = run(['systemctl', 'show', SERVICE, '--no-pager',
                  '--property=ActiveState', '--property=MainPID',
                  '--property=UnitFileState', '--property=TriggeredBy'])
    require(result.returncode == 0, 'SOURCE_STATUS_UNAVAILABLE')
    fields = dict(line.split('=', 1) for line in result.stdout.decode('utf-8').splitlines()
                  if '=' in line)
    require(fields.get('ActiveState') == 'inactive' and fields.get('MainPID') == '0',
            'SOURCE_NOT_STOPPED')
    require(fields.get('UnitFileState') in ('disabled', 'masked', 'masked-runtime')
            and fields.get('TriggeredBy') == '', 'SOURCE_AUTOSTART_NOT_DISABLED')


def unchanged_main(manifest):
    require(ENABLED.resolve(strict=True) == SITE and not SITE.is_symlink(), 'SITE_PATH_CHANGED')
    require(digest(checked_file(MAIN)) == manifest['main_sha256'], 'MAIN_CONFIG_CHANGED')


def install(data, expected, info):
    require(checked_file(SITE) == expected, 'LIVE_CONFIG_CHANGED')
    descriptor, filename = tempfile.mkstemp(prefix='.outdoor-fit-proxy-', dir=str(SITE.parent))
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            os.fsync(stream.fileno())
        require(checked_file(SITE) == expected, 'LIVE_CONFIG_CHANGED')
        os.replace(filename, SITE)
        directory = os.open(str(SITE.parent), os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(filename):
            os.unlink(filename)


def request(host, route, local=False):
    args = ['curl', '--disable', '--silent', '--show-error', '--noproxy', '*',
            '--proto', '=https', '--tlsv1.2', '--connect-timeout', '3',
            '--cacert', str(PUBLIC_CA),
            '--max-time', '8', '--max-filesize', '8192', '--write-out', '\n%{http_code}']
    if local:
        args += ['--resolve', host + ':443:127.0.0.1']
    args += ['https://' + host + route]
    try:
        result = run(args, timeout=12)
    except (OSError, subprocess.SubprocessError):
        return None, None
    if result.returncode != 0 or len(result.stdout) > 8196:
        return None, None
    body, separator, code = result.stdout.rpartition(b'\n')
    return (code, body) if separator else (None, None)


def healthy(host, local=False):
    code, body = request(host, '/api/health', local)
    if code != b'200':
        return False
    try:
        value = json.loads(body)
    except (ValueError, UnicodeError):
        return False
    return (isinstance(value, dict) and set(value) == {'ok', 'service'}
            and value['ok'] is True and value['service'] == 'outdoor-fit-api')


def wait_local_health():
    deadline = time.monotonic() + 30
    while True:
        if healthy(HOST, local=True):
            return
        require(time.monotonic() < deadline, 'OLD_HTTPS_HEALTH_FAILED')
        time.sleep(2)


def restore_maintenance(files, manifest, info):
    try:
        unchanged_main(manifest)
        current = checked_file(SITE)
        require(current in (files['maintenance.conf'], files['aliyun.conf']), 'LIVE_CONFIG_CHANGED')
        if current != files['maintenance.conf']:
            install(files['maintenance.conf'], current, info)
        require(run(['nginx', '-t']).returncode == 0, 'MAINTENANCE_NGINX_CHECK_FAILED')
        require(run(['systemctl', 'reload', 'nginx']).returncode == 0, 'MAINTENANCE_RELOAD_FAILED')
        deadline = time.monotonic() + 30
        while True:
            if all(request(HOST, route, local=True)[0] == b'503'
                   for route in ('/api/health', '/api/admin/media/upload')):
                print('MAINTENANCE_RESTORED=YES', flush=True)
                return
            require(time.monotonic() < deadline, 'MAINTENANCE_RESPONSE_FAILED')
            time.sleep(2)
    except BaseException:
        print('MAINTENANCE_RESTORED=REVIEW_REQUIRED', flush=True)


def main():
    require(os.geteuid() == 0, 'ACTIVATE_REQUIRES_ROOT')
    require(len(sys.argv) == 2 and sys.argv[1] == str(CUTOVER), 'EXACT_CUTOVER_DIR_REQUIRED')
    require(shutil.which('curl') is not None, 'CURL_REQUIRED')
    require(PUBLIC_CA.is_file(), 'PUBLIC_CA_UNAVAILABLE')
    info = CUTOVER.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, 'CUTOVER_DIR_INVALID')
    os.umask(0o077)
    lock_fd = os.open(str(CUTOVER / 'freeze.lock'), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(lock_fd, 'a') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0
                and not info.st_mode & 0o077, 'CUTOVER_LOCK_INVALID')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = json.loads(checked_file(CUTOVER / 'manifest.json'))
        require(manifest['source'] == str(SITE), 'MANIFEST_SOURCE_CHANGED')
        files = {name: checked_file(CUTOVER / name) for name in
                 ('original.conf', 'maintenance.conf', 'aliyun.conf')}
        require(all(digest(value) == manifest['files'][name] for name, value in files.items())
                and digest(files['original.conf']) == manifest['source_sha256'], 'CANDIDATE_HASH_CHANGED')
        unchanged_main(manifest)
        previous = checked_file(SITE)
        require(previous in (files['maintenance.conf'], files['aliyun.conf']),
                'LIVE_CONFIG_NOT_MAINTENANCE_OR_ALIYUN')
        source_stopped()
        probe = run(['nginx', '-T'])
        require(probe.returncode == 0, 'CURRENT_NGINX_CONFIG_INVALID')
        active = set(re.findall(r'(?m)^# configuration file (/[^\r\n]+):\r?$',
                                probe.stdout.decode('utf-8')))
        require(active == EXPECTED, 'ACTIVE_NGINX_FILES_CHANGED')
        site_info = SITE.stat()
        try:
            require(healthy(UPSTREAM), 'ALIYUN_HTTPS_HEALTH_FAILED')
            print('ALIYUN_HTTPS_HEALTH=PASS', flush=True)
            unchanged_main(manifest)
            source_stopped()
            require(checked_file(SITE) == previous, 'LIVE_CONFIG_CHANGED')
            already_active = previous == files['aliyun.conf'] and healthy(HOST, local=True)
            if not already_active:
                if previous != files['aliyun.conf']:
                    install(files['aliyun.conf'], previous, site_info)
                require(run(['nginx', '-t']).returncode == 0, 'ALIYUN_NGINX_CHECK_FAILED')
                require(run(['systemctl', 'reload', 'nginx']).returncode == 0, 'ALIYUN_RELOAD_FAILED')
                wait_local_health()
            unchanged_main(manifest)
            require(checked_file(SITE) == files['aliyun.conf'], 'LIVE_CONFIG_CHANGED')
            source_stopped()
        except BaseException:
            restore_maintenance(files, manifest, site_info)
            raise
        print('ACTIVATION_MODE=' + ('ALREADY_ACTIVE' if already_active else 'INSTALLED'), flush=True)
        print('OLD_HTTPS_HEALTH=PASS', flush=True)
        print('TLS_VERIFICATION=ENABLED', flush=True)
        print('SOURCE_ACTIVE_STATE=inactive', flush=True)
        print('SOURCE_MAIN_PID=0', flush=True)
        print('SOURCE_AUTOSTART=DISABLED', flush=True)
        print('LIVE_CONFIG_SHA256=' + digest(files['aliyun.conf']), flush=True)
        print('GOOGLE_PROXY_ACTIVATION=COMPLETE', flush=True)


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'[A-Z0-9_]+', str(error)) else type(error).__name__.upper()
        print('GOOGLE_PROXY_ACTIVATION=FAILED', flush=True)
        print('ERROR_CODE=' + code, flush=True)
        print('SOURCE_NOT_AUTOMATICALLY_RESTARTED', flush=True)
        sys.exit(1)
