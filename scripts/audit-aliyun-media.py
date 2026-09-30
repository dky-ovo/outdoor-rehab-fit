#!/usr/bin/env python3
"""Read-only media audit for a frozen SQLite snapshot and its tar.gz backup.

Python 3.10+ standard library only. Nothing is extracted or imported. Exit 0:
no errors; 1: report written with findings; 2: unsafe input or audit failure.
The JSON contains counts and technical relative paths, never business rows.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tarfile


ROOTS = ("data/equipment-images", "data/media-library", "media-seed")
SIDECARS = ("-wal", "-shm", "-journal")
MANIFEST = "media-seed/manifest.json"
BLOCK = 1024 * 1024
MAX_MANIFEST = 2 * BLOCK
MAX_PATHS = 200
STORAGE = re.compile(r"[a-f0-9-]+\.(?:png|jpg|gif|webp|mp4|mov|webm|bin)\Z")
IMAGE_URL = re.compile(r"/api/equipment-images/([a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|gif|webp))\Z", re.I)
MEDIA_URL = re.compile(r"/api/media/([a-zA-Z0-9-]+)/([a-zA-Z0-9-]+\.(?:png|jpg|jpeg|gif|webp|mp4|mov|webm|bin))\Z", re.I)
HASH = re.compile(r"[a-fA-F0-9]{64}\Z")
SEED_NAME = re.compile(r"[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,12}\Z")
MEDIA_COLUMNS = ("id", "url", "source", "storage_name", "sha256", "size_bytes", "kind", "mime_type", "archived", "deleted_at")
EQUIPMENT_COLUMNS = ("image_url", "gif_left_url", "gif_right_url", "video_url", "video_url_zh", "video_url_en", "youtube_key")


class AuditError(Exception):
    """A safe, fixed diagnostic, without source contents or business values."""


class Findings:
    def __init__(self):
        self.groups = {}

    def add(self, code, path=None, warning=False):
        item = self.groups.setdefault(code, {"severity": "warning" if warning else "error", "count": 0, "paths": set()})
        item["count"] += 1
        if path is not None:
            item["paths"].add(path)

    def result(self):
        return {code: {"severity": item["severity"], "count": item["count"],
                       "paths": sorted(item["paths"])[:MAX_PATHS],
                       "omitted_path_count": max(0, len(item["paths"]) - MAX_PATHS)}
                for code, item in sorted(self.groups.items())}

    def has_errors(self):
        return any(item["severity"] == "error" for item in self.groups.values())


def signature(path):
    info = path.stat()
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def digest_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def no_sidecars(database):
    if any(os.path.lexists(str(database) + suffix) for suffix in SIDECARS):
        raise AuditError("Database sidecar exists; use the completed standalone snapshot")


def validate_paths(arguments):
    supplied = [Path(arguments.database), Path(arguments.archive), Path(arguments.output)]
    if not all(path.is_absolute() for path in supplied):
        raise AuditError("All three paths must be absolute")
    database, archive = [path.resolve(strict=True) for path in supplied[:2]]
    if not all(path.is_file() for path in (database, archive)) or database.samefile(archive):
        raise AuditError("Database and archive must be distinct regular files")
    output = supplied[2].parent.resolve(strict=True) / supplied[2].name
    reserved = {database, archive, *(Path(str(database) + suffix) for suffix in SIDECARS)}
    if output in reserved or os.path.lexists(output):
        raise AuditError("Output exists or aliases an input; refusing to overwrite")
    no_sidecars(database)
    return database, archive, output


def member_path(value):
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value or "\0" in value:
        raise AuditError("Unsafe archive member path")
    while value.startswith("./"):
        value = value[2:]
    value = value.rstrip("/")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise AuditError("Unsafe archive member path")
    if value != "data" and not any(value == root or value.startswith(root + "/") for root in ROOTS):
        raise AuditError("Archive member is outside the three expected trees")
    return value


def read_archive(archive):
    entries, manifest_bytes = {}, None
    with archive.open("rb") as raw, gzip.GzipFile(fileobj=raw, mode="rb") as compressed:
        with tarfile.open(fileobj=compressed, mode="r|") as bundle:
            for member in bundle:
                name = member_path(member.name)
                if name in entries:
                    raise AuditError("Duplicate archive member")
                if member.isdir():
                    entries[name] = {"type": "directory"}
                elif member.islnk():
                    if name == "data" or name in ROOTS:
                        raise AuditError("Archive tree root is not a directory")
                    entries[name] = {"type": "hardlink", "target": member_path(member.linkname)}
                elif member.isreg():
                    if member.size < 0 or name == "data" or name in ROOTS:
                        raise AuditError("Invalid archive regular member")
                    if name == MANIFEST and member.size > MAX_MANIFEST:
                        raise AuditError("Seed manifest exceeds the size limit")
                    digest, count, captured = hashlib.sha256(), 0, []
                    with bundle.extractfile(member) as stream:
                        for block in iter(lambda: stream.read(BLOCK), b""):
                            count += len(block)
                            digest.update(block)
                            if name == MANIFEST:
                                captured.append(block)
                    if count != member.size:
                        raise AuditError("Truncated archive member")
                    entries[name] = {"type": "regular", "size": count, "sha256": digest.hexdigest()}
                    if name == MANIFEST:
                        manifest_bytes = b"".join(captured)
                else:
                    raise AuditError("Symbolic link or special archive member is not allowed")
        # Read through the gzip trailer too, checking its CRC and stream length.
        while compressed.read(BLOCK):
            pass

    files = {}
    for name, item in entries.items():
        parent = name.rpartition("/")[0]
        while parent:
            if parent in entries and entries[parent]["type"] != "directory":
                raise AuditError("Archive path descends through a non-directory member")
            parent = parent.rpartition("/")[0]
        if item["type"] == "directory":
            continue
        current, seen = name, set()
        while True:
            if current in seen:
                raise AuditError("Archive hardlink cycle")
            seen.add(current)
            target = entries.get(current)
            if target is None or target["type"] == "directory":
                raise AuditError("Archive hardlink target is absent or not a regular file")
            if target["type"] == "regular":
                files[name] = {"size": target["size"], "sha256": target["sha256"], "resolved_member": current}
                break
            current = target["target"]

    if MANIFEST in files and manifest_bytes is None:
        if files[MANIFEST]["size"] > MAX_MANIFEST:
            raise AuditError("Seed manifest exceeds the size limit")
        # A legal hardlinked manifest may refer to an earlier or later member.
        with tarfile.open(archive, mode="r|gz") as bundle:
            for member in bundle:
                if member_path(member.name) == files[MANIFEST]["resolved_member"]:
                    with bundle.extractfile(member) as stream:
                        manifest_bytes = stream.read(MAX_MANIFEST + 1)
                    break

    def totals(prefix=None):
        selected = {name: item for name, item in entries.items()
                    if prefix is None or name == prefix or name.startswith(prefix + "/")}
        return {"regular_files": sum(item["type"] == "regular" for item in selected.values()),
                "hardlinks": sum(item["type"] == "hardlink" for item in selected.values()),
                "directories": sum(item["type"] == "directory" for item in selected.values()),
                "stored_bytes": sum(item.get("size", 0) for item in selected.values()),
                "file_paths": sum(name in files for name in selected),
                "logical_bytes": sum(files[name]["size"] for name in selected if name in files)}

    return files, manifest_bytes, {"totals": totals(), "trees": {root: totals(root) for root in ROOTS}}


def columns(connection, table):
    row = connection.execute("SELECT type FROM sqlite_master WHERE name=?", (table,)).fetchone()
    if row is None or row[0] != "table":
        raise AuditError("Required audit table is absent or is not a table")
    return {row[1] for row in connection.execute('PRAGMA table_info("' + table + '")')}


def local_path(url):
    if not isinstance(url, str):
        return None
    match = IMAGE_URL.fullmatch(url)
    if match:
        return "data/equipment-images/" + match[1], None
    match = MEDIA_URL.fullmatch(url)
    if match:
        return "data/media-library/" + match[2], (match[1], match[2])
    if url.startswith(("/api/media/", "/api/equipment-images/")):
        return "", None
    return None


def check_metadata(files, findings, path, size, digest, kind=None, seed=False):
    prefix = "seed_" if seed else "runtime_"
    item = files.get(path)
    if item is None:
        findings.add(prefix + "missing_file", path)
        return
    if size is None:
        findings.add(prefix + "size_metadata_unavailable", path, warning=True)
    elif type(size) is not int or size < 0 or item["size"] != size:
        findings.add(prefix + "size_mismatch", path)
    if not isinstance(digest, str) or not HASH.fullmatch(digest):
        findings.add(prefix + "sha256_metadata_unavailable", path, warning=True)
    elif item["sha256"] != digest.lower():
        findings.add(prefix + "sha256_mismatch", path)
    if kind in ("image", "video") and item["size"] == 0:
        findings.add(prefix + "empty_media", path)


def audit_references(database, files, findings):
    connection = sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only=ON")
        connection.execute("PRAGMA trusted_schema=OFF")
        if not set(MEDIA_COLUMNS).issubset(columns(connection, "media_files")):
            raise AuditError("Required media metadata columns are absent")
        media = list(connection.execute("SELECT " + ",".join(MEDIA_COLUMNS) + " FROM media_files"))
        registry = {row["id"]: row for row in media}
        source_counts, runtime_paths, indexed_paths = Counter(), set(), set()
        deleted_count = archived_count = 0
        for row in media:
            source = row["source"]
            source_counts[source if source in ("upload", "legacy", "external", "youtube") else "invalid"] += 1
            deleted_count += row["deleted_at"] is not None
            archived_count += bool(row["archived"])
            mapped = local_path(row["url"])
            if source == "upload":
                storage = row["storage_name"]
                if not isinstance(storage, str) or not STORAGE.fullmatch(storage):
                    findings.add("invalid_upload_storage_name")
                    continue
                path = "data/media-library/" + storage
                if row["url"] != f'/api/media/{row["id"]}/{storage}':
                    findings.add("invalid_upload_url", path)
            elif mapped is not None:
                path, link = mapped
                if not path:
                    findings.add("invalid_local_url")
                    continue
                if link:
                    target = registry.get(link[0])
                    if target is None or target["source"] != "upload" or target["storage_name"] != link[1] or target["deleted_at"] is not None:
                        findings.add("media_local_url_unavailable", path)
            else:
                continue
            runtime_paths.add(path)
            indexed_paths.add(path)
            check_metadata(files, findings, path, row["size_bytes"], row["sha256"], row["kind"])

        equipment_columns = columns(connection, "app_equipment_items")
        available = [name for name in EQUIPMENT_COLUMNS if name in equipment_columns]
        urls = set()
        if available:
            for row in connection.execute("SELECT " + ",".join(available) + " FROM app_equipment_items"):
                urls.update(value for value in row if isinstance(value, str) and local_path(value) is not None)
        if "value" not in columns(connection, "content_items"):
            raise AuditError("Content value column is absent")
        for row in connection.execute("SELECT value FROM content_items WHERE typeof(value)='text' AND (value LIKE '/api/media/%' OR value LIKE '/api/equipment-images/%')"):
            if local_path(row[0]) is not None:
                urls.add(row[0])
        for url in urls:
            path, link = local_path(url)
            if not path:
                findings.add("invalid_local_url")
                continue
            runtime_paths.add(path)
            if path not in files and path not in indexed_paths:
                findings.add("runtime_missing_file", path)
            if link:
                row = registry.get(link[0])
                if row is None or row["source"] != "upload" or row["storage_name"] != link[1] or row["deleted_at"] is not None:
                    findings.add("business_local_url_unavailable", path)
            if path not in indexed_paths and path in files:
                findings.add("runtime_media_metadata_unavailable", path, warning=True)
        return {"media_rows": len(media), "source_counts": dict(sorted(source_counts.items())),
                "deleted_media_rows_included": deleted_count, "archived_media_rows_included": archived_count,
                "distinct_business_local_urls": len(urls), "distinct_runtime_paths_checked": len(runtime_paths),
                "unreferenced_runtime_file_paths": sum(name.startswith(ROOTS[:2]) and name not in runtime_paths for name in files)}
    finally:
        connection.close()


def audit_seed(manifest_bytes, files, findings):
    if manifest_bytes is None:
        findings.add("seed_manifest_absent", MANIFEST, warning=True)
        return {"manifest_items_checked": 0}
    try:
        manifest = json.loads(manifest_bytes)
        items = manifest["items"]
        if not isinstance(items, list):
            raise ValueError()
    except (ValueError, TypeError, KeyError, UnicodeError):
        findings.add("seed_manifest_invalid", MANIFEST)
        return {"manifest_items_checked": 0}
    seen, checked = set(), 0
    for item in items:
        name = item.get("fileName") if isinstance(item, dict) else None
        if not isinstance(name, str) or not SEED_NAME.fullmatch(name) or name in seen:
            findings.add("seed_manifest_invalid_item", MANIFEST)
            continue
        seen.add(name)
        checked += 1
        check_metadata(files, findings, "media-seed/files/" + name, item.get("size"), item.get("sha256"), seed=True)
    return {"manifest_items_checked": checked}


def write_report(output, report):
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    created = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            descriptor = None
            json.dump(report, stream, ensure_ascii=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        try:
            current = output.lstat()
            if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                output.unlink()
        except OSError:
            pass
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("database", "archive", "output"):
        parser.add_argument("--" + name, required=True)
    arguments = parser.parse_args(argv)
    try:
        database, archive, output = validate_paths(arguments)
        db_stat, archive_stat = signature(database), signature(archive)
        before = digest_file(database)
        findings = Findings()
        files, manifest_bytes, archive_report = read_archive(archive)
        runtime = audit_references(database, files, findings)
        seed = audit_seed(manifest_bytes, files, findings)
        after = digest_file(database)
        no_sidecars(database)
        if before != after or db_stat != signature(database) or archive_stat != signature(archive):
            raise AuditError("Input changed during audit; no report was written")
        report = {"format_version": 1, "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                  "status": "findings" if findings.has_errors() else "ok",
                  "database": {"sha256_before": before, "sha256_after": after, "unchanged": True, "size_bytes": db_stat[2]},
                  "archive": archive_report, "runtime": runtime, "seed": seed, "findings": findings.result(),
                  "scope": {"business_rows_exported": False, "archive_extracted": False,
                            "same_point_in_time_consistency_asserted": False,
                            "privacy_note": "Counts and technical relative paths only; per-file metadata may be absent."}}
        write_report(output, report)
        print("MEDIA_ROWS", runtime["media_rows"])
        print("RUNTIME_PATHS_CHECKED", runtime["distinct_runtime_paths_checked"])
        print("ARCHIVE_FILE_PATHS", archive_report["totals"]["file_paths"])
        print("SEED_ITEMS_CHECKED", seed["manifest_items_checked"])
        for severity in ("error", "warning"):
            print(severity.upper() + "_COUNT", sum(item["count"] for item in report["findings"].values() if item["severity"] == severity))
        for code, item in report["findings"].items():
            print("FINDING", code, item["count"])
        print("REPORT_FILE", output)
        return 1 if findings.has_errors() else 0
    except AuditError as error:
        print("Audit refused: " + str(error), file=sys.stderr)
    except (OSError, sqlite3.Error, tarfile.TarError, EOFError, ValueError, RecursionError):
        # Do not serialize exception messages: they can contain filenames or data.
        print("Audit failed: input/output, SQLite, or archive could not be safely processed", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
