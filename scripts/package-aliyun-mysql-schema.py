#!/usr/bin/env python3
"""Build the explicit source-only allowlist for the empty RDS test schema."""
import hashlib
import json
from pathlib import Path
import tarfile

workspace = Path(__file__).resolve().parent.parent
destination = workspace / "deploy/aliyun-mysql-schema/aliyun-mysql-schema-v1.tar.gz"
prefix = "aliyun-mysql-schema-20260924-v1"
files = {
    "Dockerfile": "deploy/aliyun-mysql-schema/Dockerfile",
    "run-create-schema.sh": "deploy/aliyun-mysql-schema/run-create-schema.sh",
    "package.json": "server/package.json",
    "package-lock.json": "server/package-lock.json",
    "src/mysqlConfig.js": "server/src/mysqlConfig.js",
    "src/mysqlDatabase.js": "server/src/mysqlDatabase.js",
    "src/mysqlSchema.js": "server/src/mysqlSchema.js",
    "src/mysqlSchemaApply.js": "server/src/mysqlSchemaApply.js",
    "scripts/create-aliyun-mysql-schema.js": "server/scripts/create-aliyun-mysql-schema.js",
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
    if sorted(member.name for member in bundle) != sorted(prefix + "/" + name for name in files):
        raise SystemExit("PACKAGE_MANIFEST_MISMATCH")
print("PACKAGE_FILE=" + str(destination))
print("FILE_COUNT=" + str(len(files)))
print("SIZE_BYTES=" + str(destination.stat().st_size))
print("SHA256=" + hashlib.sha256(destination.read_bytes()).hexdigest())
