#!/usr/bin/env python3
"""Package production migration source only. Never include final input data."""
import hashlib
import json
from pathlib import Path
import tarfile

workspace = Path(__file__).resolve().parent.parent
destination = workspace / "deploy/aliyun-production-migration/aliyun-production-migration-v1.tar.gz"
prefix = "aliyun-production-migration-20260924-v1"
files = {
    "Dockerfile": "deploy/aliyun-production-migration/Dockerfile",
    ".dockerignore": "deploy/aliyun-production-migration/.dockerignore",
    "README.md": "deploy/aliyun-production-migration/README.md",
    "FINAL-SNAPSHOT.md": "deploy/aliyun-production-migration/FINAL-SNAPSHOT.md",
    "run-production-migration.sh": "deploy/aliyun-production-migration/run-production-migration.sh",
    "export-aliyun-sqlite.py": "scripts/export-aliyun-sqlite.py",
    "package.json": "server/package.json",
    "package-lock.json": "server/package-lock.json",
    "src/mysqlConfig.js": "server/src/mysqlConfig.js",
    "src/mysqlDatabase.js": "server/src/mysqlDatabase.js",
    "src/mysqlSchema.js": "server/src/mysqlSchema.js",
    "src/mysqlSchemaApply.js": "server/src/mysqlSchemaApply.js",
    "src/sqliteExportReader.js": "server/src/sqliteExportReader.js",
    "src/mysqlDataImport.js": "server/src/mysqlDataImport.js",
    "scripts/productionMigrationCli.js": "server/scripts/productionMigrationCli.js",
    "scripts/create-aliyun-production-schema.js": "server/scripts/create-aliyun-production-schema.js",
    "scripts/import-aliyun-production-data.js": "server/scripts/import-aliyun-production-data.js",
    "migration/source-schema-audit.json": "docs/aliyun-source-schema-audit.json",
}
package = json.loads((workspace / "server/package.json").read_text(encoding="utf-8"))
lock = json.loads((workspace / "server/package-lock.json").read_text(encoding="utf-8"))
if package["dependencies"].get("mysql2") != "3.24.4" or lock["packages"]["node_modules/mysql2"]["version"] != "3.24.4":
    raise SystemExit("MYSQL_DRIVER_LOCK_MISMATCH")
for relative in files.values():
    source = workspace / relative
    if not source.is_file() or source.is_symlink() or workspace not in source.resolve().parents:
        raise SystemExit("PACKAGE_INPUT_UNAVAILABLE")


def metadata(info):
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mode = 0o700 if info.name.endswith(".sh") else 0o600
    return info


with tarfile.open(destination, "w:gz", format=tarfile.PAX_FORMAT) as bundle:
    for name, relative in files.items():
        bundle.add(workspace / relative, arcname=prefix + "/" + name, recursive=False, filter=metadata)
with tarfile.open(destination, "r:gz") as bundle:
    members = bundle.getmembers()
    if sorted(member.name for member in members) != sorted(prefix + "/" + name for name in files):
        raise SystemExit("PACKAGE_MANIFEST_MISMATCH")
    for member in members:
        name = member.name[len(prefix) + 1:]
        if not member.isfile() or bundle.extractfile(member).read() != (workspace / files[name]).read_bytes():
            raise SystemExit("PACKAGE_SOURCE_MISMATCH")
    docker = bundle.extractfile(prefix + "/Dockerfile").read().decode("utf-8")
    entry = json.loads(next(line[len("ENTRYPOINT "):] for line in docker.splitlines() if line.startswith("ENTRYPOINT ")))
    command = json.loads(next(line[len("CMD "):] for line in docker.splitlines() if line.startswith("CMD ")))
    if entry != ["node"] or command != ["--version"]:
        raise SystemExit("PACKAGE_ENTRYPOINT_INVALID")
    if b"\r" in bundle.extractfile(prefix + "/run-production-migration.sh").read():
        raise SystemExit("PACKAGE_SHELL_REQUIRES_LF")
print("PACKAGE_FILE=" + str(destination))
print("FILE_COUNT=" + str(len(files)))
print("SIZE_BYTES=" + str(destination.stat().st_size))
print("SHA256=" + hashlib.sha256(destination.read_bytes()).hexdigest())
