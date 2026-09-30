#!/usr/bin/env python3
"""Package an explicit, credential-free allowlist for the ECS MySQL probe."""
import hashlib
import json
from pathlib import Path
import tarfile

workspace = Path(__file__).resolve().parent.parent
destination = workspace / "deploy" / "aliyun-mysql-check" / "aliyun-mysql-check-v2.tar.gz"
prefix = "aliyun-mysql-check-20260924-v2"
files = {
    "Dockerfile": "deploy/aliyun-mysql-check/Dockerfile",
    "run-check.sh": "deploy/aliyun-mysql-check/run-check.sh",
    "package.json": "server/package.json",
    "package-lock.json": "server/package-lock.json",
    "src/mysqlConfig.js": "server/src/mysqlConfig.js",
    "src/mysqlDatabase.js": "server/src/mysqlDatabase.js",
    "scripts/check-aliyun-mysql.js": "server/scripts/check-aliyun-mysql.js",
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
    info.mode = 0o700 if info.name.endswith("run-check.sh") else 0o600
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
