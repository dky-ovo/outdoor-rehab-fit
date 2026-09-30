#!/usr/bin/env python3
"""Audit a stable SQLite backup without exporting business rows.

The JSON report contains schema DDL and defaults, which may include sensitive
literals. Review the report before sharing it. No application code is loaded.
Requires Python 3.10's standard library and an existing absolute database path.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timezone


SIDECAR_SUFFIXES = ("-wal", "-shm", "-journal")


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_paths(database_argument, output_argument):
    source_argument = Path(database_argument)
    output_argument = Path(output_argument)
    if not source_argument.is_absolute() or not output_argument.is_absolute():
        raise ValueError("--database and --output must both be absolute paths")

    source = source_argument.resolve(strict=True)
    if not source.is_file():
        raise ValueError("--database must name an existing regular file")

    output = output_argument.parent.resolve(strict=True) / output_argument.name
    if not output.parent.is_dir():
        raise ValueError("The output directory must already exist")

    reserved = []
    for base in (source, source_argument):
        reserved.append(base)
        reserved.extend(Path(str(base) + suffix) for suffix in SIDECAR_SUFFIXES)
    resolved_output = output.resolve(strict=False)
    for candidate in reserved:
        if resolved_output == candidate.resolve(strict=False):
            raise ValueError("Output cannot be the source database or its sidecar")
        if output.exists() and candidate.exists() and output.samefile(candidate):
            raise ValueError("Output cannot be a hard link to the source or its sidecar")
    if os.path.lexists(output):
        raise ValueError("Output already exists; refusing to overwrite it")
    return source, output


def rows(connection, sql, parameters=()):
    return [dict(row) for row in connection.execute(sql, parameters)]


def quote_identifier(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def audit_database(source):
    initial_stat = source.stat()
    initial_hash = sha256_file(source)
    connection = sqlite3.connect(
        source.as_uri() + "?mode=ro", uri=True, timeout=5, isolation_level=None
    )
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        connection.execute("BEGIN")
        schema_objects = rows(
            connection,
            "SELECT type, name, tbl_name, sql AS schema_sql FROM main.sqlite_master "
            "WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name",
        )
        tables = []
        for item in schema_objects:
            if item["type"] != "table":
                continue
            table_name = item["name"]
            row_count = connection.execute(
                "SELECT COUNT(*) FROM main." + quote_identifier(table_name)
            ).fetchone()[0]
            columns = rows(
                connection,
                'SELECT cid, name, type, "notnull", dflt_value, pk, hidden '
                "FROM pragma_table_xinfo(?, 'main') ORDER BY cid",
                (table_name,),
            )
            indexes = rows(
                connection,
                'SELECT seq, name, "unique", origin, partial '
                "FROM pragma_index_list(?, 'main') ORDER BY seq",
                (table_name,),
            )
            for index in indexes:
                index["columns"] = rows(
                    connection,
                    'SELECT seqno, cid, name, "desc", coll, "key" '
                    "FROM pragma_index_xinfo(?, 'main') ORDER BY seqno",
                    (index["name"],),
                )
            foreign_keys = rows(
                connection,
                'SELECT id, seq, "table", "from", "to", '
                'on_update, on_delete, "match" '
                "FROM pragma_foreign_key_list(?, 'main') ORDER BY id, seq",
                (table_name,),
            )
            tables.append({
                "name": table_name,
                "row_count": row_count,
                "columns": columns,
                "indexes": indexes,
                "foreign_keys": foreign_keys,
            })

        # Aggregate inside SQLite: no offending row identifiers or values leave
        # the database connection, and no schema_migrations rows are exported.
        violations = rows(
            connection,
            'SELECT "table" AS table_name, parent, fkid, COUNT(*) AS count '
            "FROM pragma_foreign_key_check "
            'GROUP BY "table", parent, fkid ORDER BY "table", parent, fkid',
        )
        user_version = connection.execute("PRAGMA main.user_version").fetchone()[0]
    finally:
        connection.close()

    final_hash = sha256_file(source)
    final_stat = source.stat()
    if (
        initial_hash != final_hash
        or (initial_stat.st_dev, initial_stat.st_ino, initial_stat.st_size, initial_stat.st_mtime_ns)
        != (final_stat.st_dev, final_stat.st_ino, final_stat.st_size, final_stat.st_mtime_ns)
    ):
        raise ValueError("Source changed during audit; no report was written")

    return {
        "format_version": 1,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "database_path": str(source),
            "sha256": final_hash,
            "size_bytes": final_stat.st_size,
        },
        "tool": {
            "name": "audit-aliyun-sqlite",
            "python_version": sys.version.split()[0],
            "sqlite_version": sqlite3.sqlite_version,
        },
        "user_version": user_version,
        "schema_objects": schema_objects,
        "tables": tables,
        "table_count": len(tables),
        "foreign_key_check": {
            "violation_count": sum(item["count"] for item in violations),
            "groups": violations,
        },
        "scope": {
            "business_rows_exported": False,
            "integrity_check_performed": False,
            "schema_literals_notice": "DDL and defaults may contain sensitive literals; review before sharing.",
        },
    }


def write_report(output, report):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(output, flags, 0o600)
    created_stat = os.fstat(descriptor)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            descriptor = None
            json.dump(report, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        if descriptor is not None:
            os.close(descriptor)
        # Remove only the report created by this attempt, never a replacement
        # file or any source database/sidecar.
        try:
            current_stat = output.lstat()
            if (current_stat.st_dev, current_stat.st_ino) == (created_stat.st_dev, created_stat.st_ino):
                output.unlink()
        except OSError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Absolute path to a stable SQLite backup")
    parser.add_argument("--output", required=True, help="Absolute path to a new private JSON report")
    arguments = parser.parse_args()
    try:
        source, output = validate_paths(arguments.database, arguments.output)
        report = audit_database(source)
        write_report(output, report)
    except (OSError, sqlite3.Error, ValueError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 1
    for table in report["tables"]:
        print("TABLE {} ROWS {}".format(json.dumps(table["name"], ensure_ascii=True), table["row_count"]))
    print("TABLE_COUNT", report["table_count"])
    print("FK_VIOLATIONS", report["foreign_key_check"]["violation_count"])
    print("REPORT_FILE", output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
