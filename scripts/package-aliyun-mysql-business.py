#!/usr/bin/env python3
"""Package source-only RDS business acceptance tools, with no business data."""
import hashlib
import json
from pathlib import Path
import tarfile

workspace = Path(__file__).resolve().parent.parent
destination = workspace / "deploy/aliyun-mysql-business/aliyun-mysql-business-v1.tar.gz"
prefix = "aliyun-mysql-business-20260924-v1"
files = {
    "Dockerfile": "deploy/aliyun-mysql-business/Dockerfile",
    ".dockerignore": "deploy/aliyun-mysql-business/.dockerignore",
    "run-business-check.sh": "deploy/aliyun-mysql-business/run-business-check.sh",
    "package.json": "server/package.json",
    "package-lock.json": "server/package-lock.json",
    "src/mysqlConfig.js": "server/src/mysqlConfig.js",
    "src/mysqlDatabase.js": "server/src/mysqlDatabase.js",
    "src/mysqlSchema.js": "server/src/mysqlSchema.js",
    "src/mysqlSchemaApply.js": "server/src/mysqlSchemaApply.js",
    "src/adminPermissions.js": "server/src/adminPermissions.js",
    "src/adminAuthorization.js": "server/src/adminAuthorization.js",
    "src/systemLog.js": "server/src/systemLog.js",
    "src/learningProgress.js": "server/src/learningProgress.js",
    "src/registrationRepository.js": "server/src/registrationRepository.js",
    "src/appTextsRepository.js": "server/src/appTextsRepository.js",
    "scripts/check-aliyun-business.js": "server/scripts/check-aliyun-business.js",
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
    command = json.loads(next(line[4:] for line in docker.splitlines() if line.startswith("CMD ")))
    if command[:2] != ["node", "scripts/check-aliyun-business.js"] or "--apply" not in command:
        raise SystemExit("PACKAGE_ENTRYPOINT_INVALID")
    if b"\r" in bundle.extractfile(prefix + "/run-business-check.sh").read():
        raise SystemExit("PACKAGE_SHELL_REQUIRES_LF")
print("PACKAGE_FILE=" + str(destination))
print("FILE_COUNT=" + str(len(files)))
print("SIZE_BYTES=" + str(destination.stat().st_size))
print("SHA256=" + hashlib.sha256(destination.read_bytes()).hexdigest())
