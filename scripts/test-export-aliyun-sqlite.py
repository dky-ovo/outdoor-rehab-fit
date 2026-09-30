#!/usr/bin/env python3
"""Synthetic-only tests; never opens an application database or uses a network."""

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).with_name("export-aliyun-sqlite.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("sqlite_export", SCRIPT)
exporter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(exporter)


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="sqlite-export-synthetic-")
        self.directory = Path(self.temporary.name).resolve()
        self.source = self.directory / "source.sqlite"
        self.output = self.directory / "private.jsonl"
        connection = sqlite3.connect(str(self.source))
        connection.executescript('''
            PRAGMA user_version=7;
            CREATE TABLE parent (id INTEGER PRIMARY KEY, label TEXT UNIQUE);
            CREATE TABLE "odd""table" (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id),
                loose, actual_real REAL, note TEXT, binary_value BLOB,
                computed TEXT GENERATED ALWAYS AS (note || '!') STORED);
            CREATE INDEX odd_partial ON "odd""table"(note COLLATE NOCASE DESC) WHERE parent_id IS NOT NULL;
            CREATE TABLE empty_table (id TEXT PRIMARY KEY) WITHOUT ROWID;
            CREATE VIEW labels AS SELECT label FROM parent;
        ''')
        connection.execute("INSERT INTO parent VALUES (?,?)", (1, "PRIVATE_PARENT"))
        connection.execute('INSERT INTO "odd""table"(id,parent_id,loose,actual_real,note,binary_value) VALUES (?,?,?,?,?,?)',
                           (1, 1, 9223372036854775807, math.nextafter(0.1, 1), "PRIVATE_TEXT\n中文 🏃\x00", b"\x00\xff\x10"))
        connection.execute('INSERT INTO "odd""table"(id,parent_id,loose,actual_real,note,binary_value) VALUES (?,?,?,?,?,?)',
                           (2, None, -9223372036854775808, None, "", b""))
        connection.commit()
        connection.close()

    def tearDown(self):
        self.temporary.cleanup()

    def read_export(self):
        lines = self.output.read_bytes().splitlines(keepends=True)
        return lines, [json.loads(line) for line in lines]

    def assert_refused(self, source=None, output=None, code=None):
        with self.assertRaises(exporter.ExportError) as raised:
            exporter.export_database(source or self.source, output or self.output)
        if code:
            self.assertEqual(raised.exception.code, code)

    def test_roundtrip_manifest_digests_and_readonly(self):
        before = exporter.hash_file(self.source)
        before_stat = exporter.stat_identity(self.source.stat())
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            self.assertEqual(exporter.main(["--database", str(self.source), "--output", str(self.output)]), 0)
        self.assertNotIn("PRIVATE_", stdout.getvalue())
        self.assertEqual(exporter.hash_file(self.source), before)
        self.assertEqual(exporter.stat_identity(self.source.stat()), before_stat)
        self.assertFalse(any(Path(str(self.source) + suffix).exists() for suffix in exporter.SIDECARS))
        if os.name == "posix":
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        lines, records = self.read_export()
        self.assertTrue(all(line.endswith(b"\n") for line in lines))
        header, footer = records[0], records[-1]
        self.assertEqual(header["format_version"], 1)
        self.assertEqual(header["source"]["sha256"], before)
        self.assertEqual(header["manifest"]["user_version"], 7)
        self.assertEqual(header["manifest_sha256"], hashlib.sha256(exporter.canonical_json(header["manifest"])).hexdigest())
        self.assertEqual(footer["manifest_sha256"], header["manifest_sha256"])
        self.assertEqual(footer["stream_sha256"], hashlib.sha256(b"".join(lines[:-1])).hexdigest())
        self.assertEqual(footer["row_count"], 3)
        self.assertEqual(footer["source_sha256"], before)
        by_name = {table["name"]: table for table in header["manifest"]["tables"]}
        odd = by_name['odd"table']
        self.assertNotIn("computed", odd["exported_columns"])
        self.assertEqual(odd["table_xinfo"][-1]["hidden"], 3)
        self.assertTrue(odd["foreign_keys"])
        self.assertTrue(any(index["partial"] for index in odd["indexes"]))
        self.assertTrue(any(item["type"] == "view" for item in header["manifest"]["schema_objects"]))
        for table in footer["tables"]:
            row_lines = [line for line, item in zip(lines, records) if item["kind"] == "row" and item["table"] == table["name"]]
            self.assertEqual(table["sha256"], hashlib.sha256(b"".join(row_lines)).hexdigest())
            self.assertEqual(table["row_count"], len(row_lines))
        row = next(item for item in records if item["kind"] == "row" and item["table"] == 'odd"table')
        values = dict(zip(odd["exported_columns"], row["values"]))
        self.assertEqual(values["loose"], {"type": "integer", "value": "9223372036854775807"})
        self.assertEqual(float(values["actual_real"]["value"]), math.nextafter(0.1, 1))
        self.assertEqual(values["note"]["value"], "PRIVATE_TEXT\n中文 🏃\x00")
        self.assertEqual(base64.b64decode(values["binary_value"]["value"], validate=True), b"\x00\xff\x10")
        second = [item for item in records if item["kind"] == "row" and item["table"] == 'odd"table'][1]
        self.assertEqual(second["values"][2], {"type": "integer", "value": "-9223372036854775808"})
        self.assertEqual(second["values"][1], {"type": "null", "value": None})

    def test_missing_source_source_aliases_existing_outputs_and_sidecars(self):
        missing = self.directory / "missing.sqlite"
        self.assert_refused(source=missing, code="EXPORT_SOURCE_MISSING_OR_NOT_FILE")
        self.assertFalse(missing.exists())
        self.assertFalse(self.output.exists())
        self.assert_refused(output=self.source, code="EXPORT_OUTPUT_IS_SOURCE_OR_SIDECAR")
        alias = self.directory / "hardlink.sqlite"
        os.link(self.source, alias)
        self.assert_refused(output=alias, code="EXPORT_OUTPUT_IS_SOURCE_OR_SIDECAR")
        self.output.write_text("DO_NOT_OVERWRITE", encoding="utf-8")
        self.assert_refused(code="EXPORT_OUTPUT_EXISTS")
        self.assertEqual(self.output.read_text(encoding="utf-8"), "DO_NOT_OVERWRITE")
        self.output.unlink()
        for suffix in exporter.SIDECARS:
            sidecar = Path(str(self.source) + suffix)
            self.assert_refused(output=sidecar, code="EXPORT_OUTPUT_IS_SOURCE_OR_SIDECAR")
            sidecar.write_bytes(b"")
            self.assert_refused(code="EXPORT_SOURCE_HAS_SIDECARS")
            sidecar.unlink()
        self.assertFalse(self.output.exists())

    def test_foreign_key_violations_fail_without_output_or_private_rows(self):
        connection = sqlite3.connect(str(self.source))
        connection.execute('UPDATE "odd""table" SET parent_id=999 WHERE id=1')
        connection.commit()
        connection.close()
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            result = exporter.main(["--database", str(self.source), "--output", str(self.output)])
        self.assertEqual(result, 1)
        self.assertIn("EXPORT_FOREIGN_KEY_VIOLATION", stderr.getvalue())
        self.assertNotIn("999", stderr.getvalue())
        self.assertNotIn("PRIVATE_", stderr.getvalue())
        self.assertFalse(self.output.exists())

    def test_source_changes_and_oversized_lines_remove_partial_output(self):
        real_hash = exporter.hash_file
        hashes = 0

        def changing_hash(path):
            nonlocal hashes
            hashes += 1
            return real_hash(path) if hashes == 1 else "0" * 64

        with mock.patch.object(exporter, "hash_file", changing_hash):
            self.assert_refused(code="EXPORT_SOURCE_CHANGED")
        self.assertFalse(self.output.exists())
        with self.assertRaises(exporter.ExportError) as raised:
            exporter.export_database(self.source, self.output, max_line_bytes=10)
        self.assertEqual(raised.exception.code, "EXPORT_LINE_TOO_LARGE")
        self.assertFalse(self.output.exists())

    def test_nonfinite_real_is_rejected_and_partial_file_removed(self):
        connection = sqlite3.connect(str(self.source))
        connection.execute('UPDATE "odd""table" SET actual_real=? WHERE id=1', (float("inf"),))
        connection.commit()
        connection.close()
        self.assert_refused(code="EXPORT_NONFINITE_REAL")
        self.assertFalse(self.output.exists())

    def test_large_text_is_one_line_and_preserved_without_console_disclosure(self):
        connection = sqlite3.connect(str(self.source))
        long_text = "PRIVATE_LARGE_" + "中" * 200000
        connection.execute('UPDATE "odd""table" SET note=? WHERE id=1', (long_text,))
        connection.commit()
        connection.close()
        exporter.export_database(self.source, self.output)
        lines, records = self.read_export()
        self.assertGreater(max(map(len, lines)), 600000)
        row = next(item for item in records if item["kind"] == "row" and item["table"] == 'odd"table')
        self.assertEqual(row["values"][4]["value"], long_text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
