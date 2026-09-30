#!/usr/bin/env python3
"""Build the frozen production source + Expo web package; never read live secrets."""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile


WORKSPACE = Path(__file__).resolve().parent.parent
PREFIX = "outdoor-fit-production-20260924-v1"
DESTINATION = WORKSPACE / "deploy/aliyun-production/outdoor-fit-production-v1.tar.gz"
CHECKSUMS = DESTINATION.parent / "SHA256SUMS"
WEB_ROOT = WORKSPACE / "tmp/aliyun-production-web-v1"
DEPLOY_FILES = (
    "Dockerfile", ".dockerignore", "Dockerfile.dockerignore", "compose.yaml",
    "Caddyfile", "env.example", "prepare-host.sh", "configure-host.py",
    "capture-google-jwt.py", "README.md",
)


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def safe_input(file):
    require(file.is_file(), "PACKAGE_INPUT_UNAVAILABLE")
    require(WORKSPACE in file.resolve().parents, "PACKAGE_INPUT_OUTSIDE_WORKSPACE")
    for component in (file, *file.parents):
        if component == WORKSPACE:
            break
        info = component.lstat()
        require(not component.is_symlink() and not (getattr(info, "st_file_attributes", 0) & 0x400), "PACKAGE_INPUT_LINK_REJECTED")
    return file


def forbidden(name, web_asset=False):
    lower = name.lower()
    return (
        (lower == "node_modules" and not web_asset) or lower == ".git" or lower.startswith(".env")
        or lower.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm", ".db", ".pem", ".key", ".p12", ".pfx", ".tar.gz", ".zip"))
        or lower in {"secrets", "credentials", "id_rsa", "id_ed25519"}
    )


def tree_files(root, web_asset=False):
    require(root.is_dir() and not root.is_symlink(), "PACKAGE_TREE_UNAVAILABLE")
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in folders:
            child = Path(directory) / name
            require(not child.is_symlink() and not (getattr(child.lstat(), "st_file_attributes", 0) & 0x400), "PACKAGE_INPUT_LINK_REJECTED")
        folders[:] = sorted(name for name in folders if not forbidden(name, web_asset))
        for name in sorted(files):
            if not forbidden(name, web_asset):
                yield safe_input(Path(directory) / name)


def inputs():
    result = {"server/package.json": safe_input(WORKSPACE / "server/package.json"),
              "server/package-lock.json": safe_input(WORKSPACE / "server/package-lock.json")}
    source = WORKSPACE / "server/src"
    for file in tree_files(source):
        if file.suffix in {".js", ".json"}:
            result["server/src/" + file.relative_to(source).as_posix()] = file
    require("server/src/production.js" in result and "server/src/appMysql.js" in result, "PACKAGE_MYSQL_ENTRYPOINT_MISSING")
    for name in DEPLOY_FILES:
        result["deploy/aliyun-production/" + name] = safe_input(WORKSPACE / "deploy/aliyun-production" / name)
    # Expo exports font/image assets under assets/node_modules/. These are
    # compiled public assets, not an installed dependency tree.
    for file in tree_files(WEB_ROOT, web_asset=True):
        result["web/" + file.relative_to(WEB_ROOT).as_posix()] = file
    require("web/index.html" in result, "PACKAGE_WEB_ENTRYPOINT_MISSING")
    expected_web = {"web/" + file.relative_to(WEB_ROOT).as_posix()
                    for file in WEB_ROOT.rglob("*") if file.is_file()}
    require({name for name in result if name.startswith("web/")} == expected_web,
            "PACKAGE_WEB_EXPORT_INCOMPLETE")
    for name in result:
        parts = PurePosixPath(name).parts
        require(not name.startswith("/") and ".." not in parts and "\\" not in name, "PACKAGE_MEMBER_INVALID")
        require(not any(forbidden(part, parts[0] == "web") for part in parts), "PACKAGE_MEMBER_FORBIDDEN")
    return dict(sorted(result.items()))


def digest(file):
    hasher = hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


class HashingReader:
    def __init__(self, stream):
        self.stream = stream
        self.hash = hashlib.sha256()

    def read(self, size=-1):
        chunk = self.stream.read(size)
        self.hash.update(chunk)
        return chunk


def tar_info(name, mode, size=0, directory=False):
    info = tarfile.TarInfo(name)
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mtime = 0
    info.mode = mode
    info.size = size
    info.type = tarfile.DIRTYPE if directory else tarfile.REGTYPE
    return info


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", action="store_true", required=True, help="Build only after release source has been frozen")
    parser.parse_args()
    files = inputs()
    archive_partial = DESTINATION.with_name(DESTINATION.name + ".partial")
    sums_partial = CHECKSUMS.with_name(CHECKSUMS.name + ".partial")
    for output in (DESTINATION, CHECKSUMS, archive_partial, sums_partial):
        require(not output.exists() and not output.is_symlink(), "PACKAGE_OUTPUT_EXISTS")
    recorded = {}
    # Exclusive private partial outputs are left for inspection on any failure.
    descriptor = os.open(archive_partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as output:
        with tarfile.open(fileobj=output, mode="w:gz", format=tarfile.PAX_FORMAT, compresslevel=6) as archive:
            directories = {PREFIX}
            for name in files:
                directories.update(str(parent) for parent in PurePosixPath(PREFIX, name).parents if str(parent) != ".")
            for directory in sorted(directories, key=lambda value: (value.count("/"), value)):
                archive.addfile(tar_info(directory, 0o755, directory=True))
            for name, file in files.items():
                safe_input(file)
                with file.open("rb") as source:
                    before = os.fstat(source.fileno())
                    require(stat.S_ISREG(before.st_mode), "PACKAGE_INPUT_NOT_REGULAR")
                    reader = HashingReader(source)
                    archive.addfile(tar_info(PREFIX + "/" + name, 0o755 if name.endswith(".sh") else 0o644, before.st_size), reader)
                    after = os.fstat(source.fileno())
                require((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns), "PACKAGE_SOURCE_CHANGED")
                recorded[name] = (before.st_size, reader.hash.hexdigest())
        output.flush()
        os.fsync(output.fileno())
    # Read every archived byte without extracting; compare against the frozen sources.
    actual = set()
    with tarfile.open(archive_partial, "r:gz") as archive:
        for member in archive:
            if member.isdir():
                continue
            require(member.isfile() and member.name.startswith(PREFIX + "/"), "PACKAGE_MEMBER_INVALID")
            name = member.name[len(PREFIX) + 1:]
            require(name in recorded and name not in actual, "PACKAGE_MANIFEST_MISMATCH")
            actual.add(name)
            hasher = hashlib.sha256()
            with archive.extractfile(member) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    hasher.update(chunk)
            require((member.size, hasher.hexdigest()) == recorded[name], "PACKAGE_CONTENT_MISMATCH")
    require(actual == set(files), "PACKAGE_MANIFEST_MISMATCH")
    for name, file in files.items():
        require(digest(safe_input(file)) == recorded[name][1], "PACKAGE_SOURCE_CHANGED")
    archive_hash = digest(archive_partial)
    descriptor = os.open(sums_partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="ascii", newline="\n") as sums:
        sums.write(archive_hash + "  " + DESTINATION.name + "\n")
        sums.flush()
        os.fsync(sums.fileno())
    # Publish without replacing any existing release or checksum.
    os.link(archive_partial, DESTINATION)
    os.link(sums_partial, CHECKSUMS)
    archive_partial.unlink()
    sums_partial.unlink()
    print("PACKAGE_FILE=" + str(DESTINATION))
    print("PACKAGE_PREFIX=" + PREFIX)
    print("FILE_COUNT=" + str(len(files)))
    print("SIZE_BYTES=" + str(DESTINATION.stat().st_size))
    print("SHA256=" + archive_hash)
    print("CHECKSUM_FILE=" + str(CHECKSUMS))


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, tarfile.TarError) as error:
        code = str(error) if isinstance(error, RuntimeError) and str(error).startswith("PACKAGE_") else "PACKAGE_BUILD_FAILED"
        raise SystemExit(code) from None
