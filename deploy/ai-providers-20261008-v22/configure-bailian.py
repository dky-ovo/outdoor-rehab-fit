#!/usr/bin/env python3
"""Create the server-only Bailian key, without changing or restarting the app."""
import getpass
import os
from pathlib import Path
import re
import stat
import sys

BASE = Path('/opt/outdoor-fit/production')
NAME = 'dashscope-api-key'


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def check_directory(directory):
    require(directory.is_dir() and not directory.is_symlink() and directory.resolve() == directory,
            'BAILIAN_SECRET_DIRECTORY_INVALID')
    mode = directory.stat()
    require(mode.st_uid == 0 and not mode.st_mode & 0o022, 'BAILIAN_SECRET_DIRECTORY_NOT_PRIVATE')


def check_existing(target):
    info = target.lstat()
    require(stat.S_ISREG(info.st_mode) and not target.is_symlink() and target.resolve() == target
            and stat.S_IMODE(info.st_mode) == 0o400 and info.st_uid == 1000 and info.st_gid == 1000
            and info.st_nlink == 1 and 1 <= info.st_size <= 4096,
            'BAILIAN_EXISTING_SECRET_REQUIRES_REVIEW')


def create_secret(target, value):
    # The key never becomes a shell argument, environment setting, report or
    # Compose value. O_EXCL refuses replacement, including symbolic links.
    require(isinstance(value, str) and 1 <= len(value) <= 4096
            and re.fullmatch(r'[!-~]+', value), 'BAILIAN_API_KEY_INVALID')
    data = value.encode('ascii')
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    created = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            os.fchown(stream.fileno(), 1000, 1000)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o400)
    except BaseException:
        # Remove only the file created in this call, never an existing key.
        now = target.lstat()
        if (now.st_dev, now.st_ino) == (created.st_dev, created.st_ino):
            target.unlink()
        raise


def main():
    os.umask(0o077)
    require(os.geteuid() == 0, 'BAILIAN_ROOT_REQUIRED')
    check_directory(BASE)
    folder = BASE / 'secrets'
    check_directory(folder)
    target = folder / NAME
    if target.exists() or target.is_symlink():
        check_existing(target)
        print('BAILIAN_KEY=ALREADY_CONFIGURED')
        print('PROVIDER_SELECTION=UNCHANGED')
        return
    require(sys.stdin.isatty(), 'BAILIAN_INTERACTIVE_TERMINAL_REQUIRED')
    value = getpass.getpass('DASHSCOPE API key (hidden, server only): ')
    confirmation = getpass.getpass('Repeat API key (hidden): ')
    require(value == confirmation, 'BAILIAN_KEY_CONFIRMATION_MISMATCH')
    create_secret(target, value)
    check_existing(target)
    print('BAILIAN_KEY=CONFIGURED')
    print('FILES_OWNER=1000:1000 FILES_MODE=0400')
    print('PROVIDER_SELECTION=UNCHANGED')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and re.fullmatch(r'BAILIAN_[A-Z0-9_]{1,80}', str(error)) else 'BAILIAN_KEY_CONFIGURATION_FAILED'
        print(code, file=sys.stderr)
        sys.exit(1)
