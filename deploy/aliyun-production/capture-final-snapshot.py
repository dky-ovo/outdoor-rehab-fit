#!/usr/bin/env python3
"""Capture the stopped Google service into a new private final snapshot.

Run as dukaiyu2004, without sudo. This script never stops/starts services,
changes source data, transfers files, or imports a database. Only a directory
ending in FINAL_SNAPSHOT_OK is suitable for transfer; failed partials remain.
"""

from contextlib import closing
import hashlib
import os
from pathlib import Path
import pwd
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time


SOURCE_HOME = Path('/home/dukaiyu2004')
APP = SOURCE_HOME / 'outdoor-fit-api'
DATABASE = APP / 'data/outdoor-fit.sqlite'
TREES = ('data/equipment-images', 'data/media-library', 'media-seed')
SIDECARS = ('', '-wal', '-shm', '-journal')
BLOCK = 1024 * 1024
EXPECTED_TABLES = 38
DIRECTORY_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK


class SnapshotError(Exception):
    """A fixed safe diagnostic, never a source filename or database value."""


def require(condition, code):
    if not condition:
        raise SnapshotError(code)


def stopped():
    try:
        result = subprocess.run(
            ['systemctl', 'show', 'outdoor-fit-api', '--no-pager',
             '--property=ActiveState', '--property=MainPID'],
            check=True, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        raise SnapshotError('SERVICE_STATE_UNAVAILABLE') from None
    fields = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    require(fields.get('ActiveState') == 'inactive' and fields.get('MainPID') == '0',
            'SOURCE_WRITES_NOT_STOPPED')


class Progress:
    def __init__(self):
        self.deadline = None
        self.next_notice = 0
        self.stage = ''

    def begin(self, stage):
        self.stage = stage
        self.next_notice = time.monotonic() + 20
        stopped()
        print('STAGE=' + stage, flush=True)

    def tick(self):
        now = time.monotonic()
        if self.deadline is not None and now >= self.deadline:
            raise SnapshotError('DATABASE_DEADLINE_EXCEEDED')
        if now >= self.next_notice:
            stopped()
            print('PROGRESS=WORKING STAGE=' + self.stage, flush=True)
            self.next_notice = now + 20


def signature(info):
    # Exclude atime: the read-only inventory itself can advance access times.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_uid, info.st_gid, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def open_directory(path):
    """Open every directory component without following any symlink."""
    require(path.is_absolute(), 'SOURCE_PATH_INVALID')
    descriptor = os.open('/', DIRECTORY_FLAGS)
    try:
        for part in path.parts[1:]:
            child = os.open(part, DIRECTORY_FLAGS, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def check_regular(info):
    require(stat.S_ISREG(info.st_mode), 'SOURCE_SPECIAL_OR_SYMBOLIC_LINK_REFUSED')
    require(info.st_nlink == 1, 'SOURCE_HARDLINK_REFUSED')


def hash_stream(stream, progress, destination=None):
    digest, size = hashlib.sha256(), 0
    while True:
        progress.tick()
        block = stream.read(BLOCK)
        if not block:
            break
        digest.update(block)
        size += len(block)
        if destination is not None:
            destination.write(block)
    return digest.hexdigest(), size


def inspect_file(directory_fd, name, progress, destination=None):
    before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    check_regular(before)
    descriptor = os.open(name, FILE_FLAGS, dir_fd=directory_fd)
    try:
        require(signature(os.fstat(descriptor)) == signature(before), 'SOURCE_CHANGED')
        with os.fdopen(descriptor, 'rb', closefd=False) as stream:
            digest, size = hash_stream(stream, progress, destination)
        require(size == before.st_size
                and signature(os.fstat(descriptor)) == signature(before)
                and signature(os.stat(name, dir_fd=directory_fd, follow_symlinks=False)) == signature(before),
                'SOURCE_CHANGED')
        return {'stat': signature(before), 'sha256': digest, 'bytes': size}
    finally:
        os.close(descriptor)


def database_inventory(progress, staging=None):
    result = {}
    descriptor = open_directory(DATABASE.parent)
    try:
        for suffix in SIDECARS:
            name = DATABASE.name + suffix
            try:
                info = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            except FileNotFoundError:
                require(suffix != '', 'SOURCE_DATABASE_MISSING')
                result[suffix] = None
                continue
            check_regular(info)
            require(suffix != '-journal', 'SOURCE_ROLLBACK_JOURNAL_PRESENT')
            if staging is not None and suffix in ('', '-wal'):
                with (staging / name).open('xb') as output:
                    result[suffix] = inspect_file(descriptor, name, progress, output)
                    output.flush()
                    os.fsync(output.fileno())
            else:
                result[suffix] = inspect_file(descriptor, name, progress)
    finally:
        os.close(descriptor)
    return result


def snapshot_database(folder, progress):
    progress.deadline = time.monotonic() + 300
    progress.begin('DATABASE_COPY')
    staging = folder / '.source-copy'
    staging.mkdir(mode=0o700)
    baseline = database_inventory(progress, staging)
    require(database_inventory(progress) == baseline, 'SOURCE_DATABASE_CHANGED')
    progress.begin('DATABASE_BACKUP')
    partial = folder / 'outdoor-fit.sqlite.partial'
    # The original database is never opened by SQLite: SQLite's WAL reader may
    # create/write SHM even with mode=ro. Its private copy retains the WAL name.
    staged = staging / DATABASE.name
    with closing(sqlite3.connect(partial, timeout=5)) as target:
        with closing(sqlite3.connect(staged.as_uri() + '?mode=ro', uri=True, timeout=5)) as source:
            source.backup(target, pages=256,
                          progress=lambda status, remaining, total: progress.tick(), sleep=0.1)
        target.set_progress_handler(lambda: (progress.tick(), 0)[1], 10000)
        require(target.execute('PRAGMA journal_mode=DELETE').fetchone()[0] == 'delete',
                'BACKUP_JOURNAL_FAILED')
        progress.begin('DATABASE_VERIFY')
        require(target.execute('PRAGMA integrity_check').fetchall() == [('ok',)],
                'BACKUP_INTEGRITY_FAILED')
        require(target.execute('PRAGMA foreign_key_check').fetchone() is None,
                'BACKUP_FOREIGN_KEY_FAILED')
        count = target.execute("SELECT count(*) FROM sqlite_master WHERE type='table' "
                               "AND substr(name, 1, 7) <> 'sqlite_'").fetchone()[0]
        require(count == EXPECTED_TABLES, 'BACKUP_TABLE_COUNT_MISMATCH')
        progress.tick()
    require(database_inventory(progress) == baseline, 'SOURCE_DATABASE_CHANGED')
    require(not any(os.path.lexists(str(partial) + suffix) for suffix in SIDECARS[1:]),
            'BACKUP_SIDECAR_REMAINS')
    partial.rename(folder / 'outdoor-fit.sqlite')
    progress.deadline = None
    return baseline


class ArchiveReader:
    def __init__(self, stream, progress):
        self.stream, self.progress = stream, progress
        self.digest = hashlib.sha256()
        self.size = 0

    def read(self, size=-1):
        self.progress.tick()
        data = self.stream.read(size)
        self.digest.update(data)
        self.size += len(data)
        return data


def media_inventory(progress, bundle=None, expected=None):
    entries = {}

    def visit(parent_fd, name, relative):
        progress.tick()
        require(name not in ('', '.', '..') and '\\' not in name and '\0' not in name,
                'MEDIA_MEMBER_NAME_INVALID')
        before = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
        is_directory = stat.S_ISDIR(before.st_mode)
        if not is_directory:
            check_regular(before)
        descriptor = os.open(name, DIRECTORY_FLAGS if is_directory else FILE_FLAGS, dir_fd=parent_fd)
        try:
            require(signature(os.fstat(descriptor)) == signature(before), 'SOURCE_MEDIA_CHANGED')
            record = {'stat': signature(before)}
            if expected is not None:
                require(relative in expected and expected[relative]['stat'] == record['stat'],
                        'SOURCE_MEDIA_CHANGED')
            if bundle is not None:
                header = tarfile.TarInfo(relative)
                header.mode = stat.S_IMODE(before.st_mode) & 0o777
                header.uid, header.gid = before.st_uid, before.st_gid
                header.mtime = before.st_mtime_ns // 1000000000
                header.type = tarfile.DIRTYPE if is_directory else tarfile.REGTYPE
                header.size = 0 if is_directory else before.st_size
            if is_directory:
                if bundle is not None:
                    bundle.addfile(header)
                for child in sorted(os.listdir(descriptor)):
                    visit(descriptor, child, relative + '/' + child)
            else:
                with os.fdopen(descriptor, 'rb', closefd=False) as stream:
                    if bundle is None:
                        digest, size = hash_stream(stream, progress)
                    else:
                        reader = ArchiveReader(stream, progress)
                        bundle.addfile(header, reader)
                        require(not stream.read(1), 'SOURCE_MEDIA_CHANGED')
                        digest, size = reader.digest.hexdigest(), reader.size
                require(size == before.st_size, 'SOURCE_MEDIA_CHANGED')
                record.update(sha256=digest, bytes=size)
            require(signature(os.fstat(descriptor)) == signature(before)
                    and signature(os.stat(name, dir_fd=parent_fd, follow_symlinks=False)) == signature(before),
                    'SOURCE_MEDIA_CHANGED')
            if expected is not None:
                require(record == expected[relative], 'SOURCE_MEDIA_CHANGED')
            entries[relative] = record
        finally:
            os.close(descriptor)

    for tree in TREES:
        path = APP / tree
        parent_fd = open_directory(path.parent)
        try:
            require(stat.S_ISDIR(os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False).st_mode),
                    'MEDIA_TREE_INVALID')
            visit(parent_fd, path.name, tree)
        finally:
            os.close(parent_fd)
    if expected is not None:
        require(entries == expected, 'SOURCE_MEDIA_CHANGED')
    return entries


def main():
    progress = Progress()
    try:
        owner = pwd.getpwnam('dukaiyu2004')
        require(os.getuid() == owner.pw_uid and os.geteuid() == owner.pw_uid
                and owner.pw_uid != 0, 'RUN_AS_DUKAIYU2004_WITHOUT_SUDO')
        os.umask(0o077)
        stopped()
        descriptor = open_directory(SOURCE_HOME)
        try:
            require(os.fstat(descriptor).st_uid == owner.pw_uid, 'SOURCE_HOME_OWNER_INVALID')
        finally:
            os.close(descriptor)
        folder = Path(tempfile.mkdtemp(prefix='outdoor-fit-final-', dir=SOURCE_HOME))
        print('FINAL_DIR=' + str(folder), flush=True)
        database_before = snapshot_database(folder, progress)
        progress.begin('MEDIA_BASELINE')
        media_before = media_inventory(progress)
        progress.begin('MEDIA_ARCHIVE')
        partial = folder / 'media.tar.gz.partial'
        with tarfile.open(partial, 'x:gz', compresslevel=1, dereference=False,
                          format=tarfile.PAX_FORMAT) as bundle:
            media_inventory(progress, bundle=bundle, expected=media_before)
        progress.begin('OUTPUT_HASHES')
        lines = []
        for name in ('outdoor-fit.sqlite', 'media.tar.gz'):
            output_path = partial if name == 'media.tar.gz' else folder / name
            with output_path.open('rb') as stream:
                digest, _ = hash_stream(stream, progress)
                os.fsync(stream.fileno())
            lines.append(digest + '  ' + name + '\n')
        progress.begin('SOURCE_RECHECK')
        require(media_inventory(progress) == media_before, 'SOURCE_MEDIA_CHANGED')
        require(database_inventory(progress) == database_before, 'SOURCE_DATABASE_CHANGED')
        stopped()
        partial.rename(folder / 'media.tar.gz')
        with (folder / 'SHA256SUMS').open('x', encoding='ascii', newline='\n') as output:
            output.writelines(lines)
            output.flush()
            os.fsync(output.fileno())
        descriptor = open_directory(folder)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        print('FINAL_SNAPSHOT_OK')
        print('TABLE_COUNT=' + str(EXPECTED_TABLES))
        print('FILE_COUNT=' + str(sum('sha256' in entry for entry in media_before.values())))
        print('MEDIA_BYTES=' + str(sum(entry.get('bytes', 0) for entry in media_before.values())))
        for line in lines:
            print(line.rstrip())
        return 0
    except SnapshotError as error:
        print(str(error), file=sys.stderr)
    except (KeyboardInterrupt, EOFError):
        print('FINAL_SNAPSHOT_CANCELLED', file=sys.stderr)
        return 130
    except sqlite3.Error:
        code = 'DATABASE_DEADLINE_EXCEEDED' if progress.deadline is not None and time.monotonic() >= progress.deadline else 'DATABASE_SNAPSHOT_FAILED'
        print(code, file=sys.stderr)
    except (OSError, ValueError, KeyError, tarfile.TarError):
        print('FINAL_SNAPSHOT_IO_FAILED', file=sys.stderr)
    except Exception:
        print('FINAL_SNAPSHOT_FAILED', file=sys.stderr)
    print('INCOMPLETE_SNAPSHOT_DO_NOT_TRANSFER', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
