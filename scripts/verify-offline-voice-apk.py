#!/usr/bin/env python3
"""Read-only packaging gate for an already-built offline-voice Android APK.

Does not download, extract, install, launch or modify the APK. Packaging checks
do not replace signing verification, a native crash log, or device testing.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

MODEL = "assets/offline-assistant-voice/sensevoice/model.int8.onnx"
TOKENS = "assets/offline-assistant-voice/sensevoice/tokens.txt"
MODEL_SIZE = 239233841
REQUIRED_LIBRARIES = ("libonnxruntime.so", "libsherpa-onnx-jni.so",
                      "libsherpa-onnx-c-api.so", "libsherpa-onnx-cxx-api.so")
DEX_MARKER = b"Lexpo/modules/offlineassistantvoice/OfflineAssistantVoiceModule;"
DEFAULT_INVENTORY = Path(__file__).resolve().parent.parent / "modules/offline-assistant-voice/native-file-inventory.json"
MAX_DEX_SIZE = 64 * 1024 * 1024
MAX_TOTAL_DEX_SIZE = 512 * 1024 * 1024


class VerificationError(ValueError):
    pass


def pinned_hashes(inventory_path):
    inventory = json.loads(Path(inventory_path).read_text(encoding="utf-8-sig"))
    hashes = {}
    for name in (MODEL, TOKENS):
        matches = [item for item in inventory.get("files", []) if item.get("path") == name]
        if len(matches) != 1 or not re.fullmatch(r"[0-9a-f]{64}", str(matches[0].get("sha256", ""))):
            raise VerificationError(f"Missing or invalid unique inventory hash: {name}")
        hashes[name] = matches[0]["sha256"]
    return hashes


def digest_entry(archive, info):
    digest = hashlib.sha256()
    read_size = 0
    with archive.open(info) as stream:
        while chunk := stream.read(1024 * 1024):
            read_size += len(chunk)
            if read_size > info.file_size:
                raise VerificationError(f"Entry exceeds declared size: {info.filename}")
            digest.update(chunk)
    if read_size != info.file_size:
        raise VerificationError(f"Truncated ZIP entry: {info.filename}")
    return digest.hexdigest()


def verify_apk(apk_path, inventory_path=DEFAULT_INVENTORY, *, expected_model_size=MODEL_SIZE):
    apk_path = Path(apk_path)
    if not apk_path.is_file():
        raise VerificationError("APK path must refer to an existing local file")
    hashes = pinned_hashes(inventory_path)
    with zipfile.ZipFile(apk_path) as archive:
        infos = archive.infolist()
        by_name = {}
        for info in infos:
            if info.filename in by_name:
                raise VerificationError(f"Ambiguous duplicate ZIP entry: {info.filename}")
            by_name[info.filename] = info
        for name in (MODEL, TOKENS):
            if name not in by_name or by_name[name].is_dir():
                raise VerificationError(f"Required offline asset missing: {name}")
            if by_name[name].flag_bits & 1:
                raise VerificationError(f"Encrypted asset is not supported: {name}")
        model = by_name[MODEL]
        if model.file_size != expected_model_size:
            raise VerificationError(f"Unexpected model size: {model.file_size}; expected {expected_model_size}")
        if model.compress_type != zipfile.ZIP_STORED:
            raise VerificationError(f"Model must use ZIP_STORED (0), got {model.compress_type}; apply noCompress at the final app packaging level")
        if model.compress_size != model.file_size:
            raise VerificationError("Stored model compressed/uncompressed sizes disagree")
        if not 0 < by_name[TOKENS].file_size <= 4 * 1024 * 1024:
            raise VerificationError("Unexpected tokens size")
        verified_assets = []
        for name in (MODEL, TOKENS):
            actual = digest_entry(archive, by_name[name])
            if actual != hashes[name]:
                raise VerificationError(f"Pinned SHA-256 mismatch: {name}")
            verified_assets.append({"path": name, "size": by_name[name].file_size, "sha256": actual})
        for library in REQUIRED_LIBRARIES:
            name = f"lib/arm64-v8a/{library}"
            if name not in by_name or by_name[name].file_size <= 0:
                raise VerificationError(f"Required arm64 library missing: {name}")
        dex = [item for item in infos if re.fullmatch(r"classes(?:[2-9]|[1-9][0-9]+)?\.dex", item.filename)]
        if not dex or "classes.dex" not in by_name:
            raise VerificationError("No primary classes.dex in APK")
        if any(item.file_size > MAX_DEX_SIZE for item in dex) or sum(item.file_size for item in dex) > MAX_TOTAL_DEX_SIZE:
            raise VerificationError("DEX data exceeds inspection bounds")
        marker_files = []
        for item in dex:
            with archive.open(item) as stream:
                header = stream.read(8)
                if not re.fullmatch(rb"dex\n[0-9]{3}\x00", header):
                    raise VerificationError(f"Invalid standard DEX header: {item.filename}")
                carry = header
                found = False
                while chunk := stream.read(1024 * 1024):
                    combined = carry + chunk
                    if DEX_MARKER in combined:
                        found = True
                    carry = combined[-(len(DEX_MARKER) - 1):]
                if found:
                    marker_files.append(item.filename)
        if not marker_files:
            raise VerificationError("OfflineAssistantVoiceModule class descriptor marker is absent from DEX")
        abis = sorted({name.split("/")[1] for name in by_name if re.match(r"^lib/[^/]+/[^/]+\.so$", name)})
        return {"ok": True, "apk": str(apk_path.resolve()), "bytes": apk_path.stat().st_size,
                "modelCompression": "ZIP_STORED", "verifiedAssets": verified_assets,
                "abis": abis, "arm64Libraries": list(REQUIRED_LIBRARIES), "dexMarkerFiles": marker_files,
                "limitations": "Packaging/integrity gate only; DEX marker is not execution or class-definition validation. Signing, Android behavior, microphone permission and crash-free operation still require separate checks."}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path, help="Existing local APK file")
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY, help="Pinned native-file-inventory.json")
    args = parser.parse_args(argv)
    try:
        report = verify_apk(args.apk, args.inventory)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
