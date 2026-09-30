#!/usr/bin/env python3
"""Export a closed, standalone SQLite snapshot to a new private JSONL file.

Python 3.10 standard library only. Never use this on a live application DB.
Each UTF-8 JSON line ends in LF and is at most 64 MiB including LF. Header
manifest_sha256 hashes canonical JSON (ensure_ascii=False, sort_keys=True,
separators=(',', ':')). Footer stream_sha256 hashes all preceding raw lines,
including LF but excluding the footer; per-table hashes cover that table's
raw row lines only. INTEGER and finite REAL values are strings, BLOB is base64.
The export contains private business data and must not be added to Git/shared.
POSIX output permissions are 0600; Windows ACLs require separate protection.
"""

import argparse
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys


FORMAT = "outdoor-fit-sqlite-export"
FORMAT_VERSION = 1
MAX_LINE_BYTES = 64 * 1024 * 1024
SIDECARS = ("-wal", "-shm", "-journal")


class ExportError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def require(condition, code):
    if not condition:
        raise ExportError(code)


def canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def hash_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def stat_identity(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def no_sidecars(*sources):
    for source in sources:
        require(not any(os.path.lexists(str(source) + suffix) for suffix in SIDECARS),
                "EXPORT_SOURCE_HAS_SIDECARS")


def validate_paths(database, output):
    original_source, original_output = Path(database), Path(output)
    require(original_source.is_absolute() and original_output.is_absolute(),
            "EXPORT_ABSOLUTE_PATHS_REQUIRED")
    require(original_source.is_file(), "EXPORT_SOURCE_MISSING_OR_NOT_FILE")
    source = original_source.resolve(strict=True)
    require(original_output.parent.is_dir(), "EXPORT_OUTPUT_DIRECTORY_MISSING")
    destination = original_output.parent.resolve(strict=True) / original_output.name
    resolved_output = destination.resolve(strict=False)
    for base in (source, original_source):
        for reserved in (base,) + tuple(Path(str(base) + suffix) for suffix in SIDECARS):
            require(resolved_output != reserved.resolve(strict=False), "EXPORT_OUTPUT_IS_SOURCE_OR_SIDECAR")
            if destination.exists() and reserved.exists():
                require(not destination.samefile(reserved), "EXPORT_OUTPUT_IS_SOURCE_OR_SIDECAR")
    require(not os.path.lexists(destination), "EXPORT_OUTPUT_EXISTS")
    no_sidecars(source, original_source)
    return source, destination, original_source


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def metadata_rows(connection, sql, parameters=()):
    cursor = connection.execute(sql, parameters)
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor]


def read_manifest(connection):
    require(connection.execute("PRAGMA main.foreign_key_check").fetchone() is None,
            "EXPORT_FOREIGN_KEY_VIOLATION")
    objects = metadata_rows(connection,
        "SELECT type,name,tbl_name AS table_name,sql FROM main.sqlite_master "
        "WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name")
    tables = []
    for item in sorted((item for item in objects if item["type"] == "table"),
                       key=lambda item: item["name"]):
        require(not re.match(r"\s*CREATE\s+VIRTUAL\b", item["sql"] or "", re.IGNORECASE),
                "EXPORT_VIRTUAL_TABLE_UNSUPPORTED")
        name = item["name"]
        columns = metadata_rows(connection,
            'SELECT cid,name,type,"notnull",dflt_value,pk,hidden '
            "FROM pragma_table_xinfo(?, 'main') ORDER BY cid", (name,))
        exported_columns = [column["name"] for column in columns if column["hidden"] == 0]
        require(bool(exported_columns), "EXPORT_NO_INSERTABLE_COLUMNS")
        indexes = metadata_rows(connection,
            'SELECT seq,name,"unique",origin,partial '
            "FROM pragma_index_list(?, 'main') ORDER BY seq", (name,))
        for index in indexes:
            index["columns"] = metadata_rows(connection,
                'SELECT seqno,cid,name,"desc",coll,"key" '
                "FROM pragma_index_xinfo(?, 'main') ORDER BY seqno", (index["name"],))
        foreign_keys = metadata_rows(connection,
            'SELECT id,seq,"table","from","to",on_update,on_delete,"match" '
            "FROM pragma_foreign_key_list(?, 'main') ORDER BY id,seq", (name,))
        count = connection.execute("SELECT COUNT(*) FROM main." + quote_identifier(name)).fetchone()[0]
        tables.append({"name": name, "row_count": count, "exported_columns": exported_columns,
                       "table_xinfo": columns, "indexes": indexes, "foreign_keys": foreign_keys})
    return {"user_version": connection.execute("PRAGMA main.user_version").fetchone()[0],
            "schema_objects": objects, "tables": tables}


def typed_value(value):
    if value is None:
        return {"type": "null", "value": None}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        require(math.isfinite(value), "EXPORT_NONFINITE_REAL")
        return {"type": "real", "value": repr(value)}
    if isinstance(value, str):
        return {"type": "text", "value": value}
    if isinstance(value, bytes):
        return {"type": "blob", "value": base64.b64encode(value).decode("ascii")}
    raise ExportError("EXPORT_UNSUPPORTED_VALUE_TYPE")


def remove_created_output(path, created_stat):
    try:
        current = path.lstat()
        if (current.st_dev, current.st_ino) == (created_stat.st_dev, created_stat.st_ino):
            path.unlink()
    except OSError:
        pass


def export_database(database, output, max_line_bytes=MAX_LINE_BYTES):
    source, destination, original_source = validate_paths(database, output)
    initial_stat = source.stat()
    source_sha256 = hash_file(source)
    require(stat_identity(source.stat()) == stat_identity(initial_stat), "EXPORT_SOURCE_CHANGED")
    no_sidecars(source, original_source)
    connection = sqlite3.connect(source.as_uri() + "?mode=ro&immutable=1",
                                 uri=True, timeout=5, isolation_level=None)
    descriptor = None
    created_stat = None
    try:
        connection.execute("PRAGMA query_only=ON")
        manifest = read_manifest(connection)
        manifest_sha256 = hashlib.sha256(canonical_json(manifest)).hexdigest()
        header = {"kind": "header", "format": FORMAT, "format_version": FORMAT_VERSION,
                  "source": {"sha256": source_sha256, "bytes": initial_stat.st_size},
                  "sqlite_version": sqlite3.sqlite_version, "manifest": manifest,
                  "manifest_sha256": manifest_sha256}
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(destination, flags, 0o600)
        created_stat = os.fstat(descriptor)
        stream_digest = hashlib.sha256()
        summaries = []
        total_rows = 0
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None

            def emit(record, table_digest=None, include_in_stream=True):
                line = canonical_json(record) + b"\n"
                require(len(line) <= max_line_bytes, "EXPORT_LINE_TOO_LARGE")
                handle.write(line)
                if include_in_stream:
                    stream_digest.update(line)
                if table_digest is not None:
                    table_digest.update(line)

            emit(header)
            for table in manifest["tables"]:
                table_digest = hashlib.sha256()
                count = 0
                columns = ",".join(quote_identifier(name) for name in table["exported_columns"])
                sql = "SELECT " + columns + " FROM main." + quote_identifier(table["name"])
                primary = sorted((column for column in table["table_xinfo"] if column["pk"]),
                                 key=lambda column: column["pk"])
                if primary:
                    sql += " ORDER BY " + ",".join(quote_identifier(column["name"]) for column in primary)
                for values in connection.execute(sql):
                    emit({"kind": "row", "table": table["name"],
                          "values": [typed_value(value) for value in values]}, table_digest)
                    count += 1
                require(count == table["row_count"], "EXPORT_ROW_COUNT_CHANGED")
                summaries.append({"name": table["name"], "row_count": count, "sha256": table_digest.hexdigest()})
                total_rows += count
            connection.close()
            connection = None
            no_sidecars(source, original_source)
            final_hash = hash_file(source)
            require(final_hash == source_sha256 and stat_identity(source.stat()) == stat_identity(initial_stat),
                    "EXPORT_SOURCE_CHANGED")
            no_sidecars(source, original_source)
            emit({"kind": "footer", "source_sha256": source_sha256, "manifest_sha256": manifest_sha256,
                  "row_count": total_rows, "tables": summaries, "stream_sha256": stream_digest.hexdigest()},
                 include_in_stream=False)
            handle.flush()
            os.fsync(handle.fileno())
        return {"table_count": len(summaries), "row_count": total_rows, "source_sha256": source_sha256,
                "manifest_sha256": manifest_sha256, "output": str(destination)}
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        if created_stat is not None:
            remove_created_output(destination, created_stat)
        raise
    finally:
        if connection is not None:
            connection.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Absolute path to a standalone SQLite snapshot")
    parser.add_argument("--output", required=True, help="Absolute path to a NEW private JSONL file")
    args = parser.parse_args(argv)
    try:
        summary = export_database(args.database, args.output)
    except ExportError as error:
        print("EXPORT FAIL", file=sys.stderr)
        print("ERROR_CODE " + error.code, file=sys.stderr)
        return 1
    except (OSError, sqlite3.Error, UnicodeError, ValueError):
        # Error messages may include SQL literals, paths or private row values.
        print("EXPORT FAIL", file=sys.stderr)
        print("ERROR_CODE EXPORT_IO_OR_SQLITE_FAILED", file=sys.stderr)
        return 1
    except Exception:
        print("EXPORT FAIL", file=sys.stderr)
        print("ERROR_CODE EXPORT_INTERNAL_FAILED", file=sys.stderr)
        return 1
    print("EXPORT PASS")
    print("TABLE_COUNT", summary["table_count"])
    print("ROW_COUNT", summary["row_count"])
    print("SOURCE_SHA256", summary["source_sha256"])
    print("MANIFEST_SHA256", summary["manifest_sha256"])
    print("EXPORT_FILE", summary["output"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
