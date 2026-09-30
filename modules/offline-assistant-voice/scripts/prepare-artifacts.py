"""Fetch only pinned upstream binaries/models; never execute downloaded code.

Run from any directory with Python 3. Stdlib only. Existing outputs are verified,
never silently overwritten. Cache is outside the native module/EAS build archive.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT.parents[1] / "workspace-artifacts" / "offline-voice-downloads"
MAX_EXPANDED = 900 * 1024 * 1024


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def safe_parts(name):
    if "\\" in name or ":" in name or "\x00" in name:
        raise ValueError("Unsafe archive path")
    parsed = PurePosixPath(name)
    if parsed.is_absolute() or any(part in ("..", ".") for part in parsed.parts):
        raise ValueError("Unsafe archive path")
    return parsed.parts


def fetch(item):
    cached = CACHE / (item["id"] + ".download")
    if cached.exists():
        if cached.stat().st_size != item["size"] or digest(cached) != item["sha256"]:
            raise ValueError(f"Cached file has wrong checksum: {cached}")
        return cached
    partial = cached.with_suffix(".partial")
    # A failed attempt's partial data is never a trusted input.
    with urllib.request.urlopen(urllib.request.Request(item["url"], headers={"User-Agent": "OutdoorFit-artifact-verifier"}), timeout=120) as response:
        final_url = response.geturl()
        if not final_url.startswith("https://"):
            raise ValueError("Refusing non-HTTPS redirect")
        with partial.open("wb") as output:
            count = 0
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                count += len(block)
                if count > item["size"]:
                    raise ValueError("Download exceeds pinned size")
                output.write(block)
    if partial.stat().st_size != item["size"] or digest(partial) != item["sha256"]:
        raise ValueError(f"Upstream checksum mismatch: {item['id']}")
    partial.rename(cached)
    return cached


def extract_model(archive, target, item):
    seen, total = set(), 0
    with tarfile.open(archive, "r:bz2") as source:
        for entry in source:
            parts = safe_parts(entry.name)
            if entry.isdir():
                continue
            if not entry.isfile() or entry.size > MAX_EXPANDED:
                raise ValueError("Unexpected model archive entry")
            leaf = parts[-1]
            if leaf not in item["include"]:
                continue
            if len(parts) != 2:
                raise ValueError("Required model file has unexpected nesting")
            if leaf in seen:
                raise ValueError("Duplicate model entry")
            seen.add(leaf)
            total += entry.size
            if total > MAX_EXPANDED:
                raise ValueError("Model expansion limit exceeded")
            target.mkdir(parents=True, exist_ok=True)
            with source.extractfile(entry) as data, (target / leaf).open("xb") as output:
                shutil.copyfileobj(data, output)
    if seen != set(item["include"]):
        raise ValueError("Required model files are missing")


def extract_framework(archive, target):
    seen, roots, total = set(), set(), 0
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            parts = safe_parts(entry.filename)
            if not parts:
                continue
            roots.add(parts[0])
            if len(roots) != 1 or not parts[0].endswith(".xcframework"):
                raise ValueError("Unexpected framework archive root")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError("Links/special files are not accepted")
            if entry.is_dir():
                continue
            relative = "/".join(parts[1:])
            if not relative or relative.casefold() in seen:
                raise ValueError("Duplicate framework entry")
            seen.add(relative.casefold())
            total += entry.file_size
            if total > MAX_EXPANDED:
                raise ValueError("Framework expansion limit exceeded")
            output_path = target.joinpath(*parts[1:])
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as data, output_path.open("xb") as output:
                shutil.copyfileobj(data, output)
            if mode & 0o111:
                output_path.chmod(0o755)


def inventory_files(path):
    if path.is_file():
        return {"": digest(path)}
    return {file.relative_to(path).as_posix(): digest(file) for file in sorted(path.rglob("*")) if file.is_file()}


def main():
    manifest = json.loads((ROOT / "native-artifacts.json").read_text(encoding="utf-8"))
    CACHE.mkdir(parents=True, exist_ok=True)
    entries = []
    for item in manifest["artifacts"]:
        print(f"Verifying {item['id']} ...", flush=True)
        archive = fetch(item)
        # Temporary directories are our own exact descendants; never delete a
        # vendor/model directory or an existing user-provided file.
        with tempfile.TemporaryDirectory(prefix="extract-", dir=CACHE) as temporary:
            target = Path(temporary) / "payload"
            if item["format"] == "aar":
                shutil.copyfile(archive, target)
            elif item["format"] == "model-tar-bz2":
                extract_model(archive, target, item)
            elif item["format"] == "xcframework-zip":
                extract_framework(archive, target)
            else:
                raise ValueError("Unsupported artifact format")
            expected = inventory_files(target)
            destination = ROOT / item["destination"]
            if destination.exists():
                if destination.is_symlink() or inventory_files(destination) != expected:
                    raise ValueError(f"Existing output differs; not overwriting: {destination}")
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                # Copy rather than rename: Python's private temp-directory ACL
                # must not follow artifacts into the normal Windows workspace.
                if target.is_dir():
                    shutil.copytree(target, destination, copy_function=shutil.copyfile)
                else:
                    shutil.copyfile(target, destination)
            for relative, sha in expected.items():
                entries.append({"path": item["destination"] + ("/" + relative if relative else ""), "sha256": sha,
                                "platform": "android" if item["id"].startswith("android") else "ios" if item["id"].startswith("ios") else "all"})
    inventory = {"schemaVersion": 1, "manifestSha256": digest(ROOT / "native-artifacts.json"), "files": entries}
    # Generated inventory is reviewed and tracked alongside the pinned upstream
    # manifest; build-time verification never updates either file.
    output = ROOT / "native-file-inventory.json"
    content = json.dumps(inventory, indent=2, ensure_ascii=False) + "\n"
    if output.exists() and json.loads(output.read_text(encoding="utf-8")) != inventory:
        raise ValueError("Tracked inventory differs; refusing to replace it")
    if not output.exists():
        output.write_text(content, encoding="utf-8")
    print(f"Verified {len(entries)} files. No network is used at app runtime.", flush=True)


if __name__ == "__main__":
    main()
