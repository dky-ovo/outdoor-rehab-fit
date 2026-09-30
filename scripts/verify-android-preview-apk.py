#!/usr/bin/env python3
"""Read-only APK integrity/resource checks; no extraction or dependency installs.

This is NOT an APK signature verifier or an Android binary-XML/DEX parser.
Obfuscated raw resource paths are matched by size, CRC, then SHA-256, not name.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile
import zlib


CHUNK = 1024 * 1024
SOUNDS = (
    "countdown_yue_halfway.wav", "countdown_yue_complete.wav",
    "countdown_en_halfway.wav", "countdown_en_complete.wav",
)
CLASS_DESCRIPTORS = (
    "Lexpo/modules/sessiontimernotification/TimerAudioService;",
    "Lexpo/modules/sessiontimernotification/SessionTimerNotificationModule;",
    "Lexpo/modules/sessiontimernotification/TimerAudioAlarmReceiver;",
)
LAYOUT_NAMES = ("session_timer_notification_compact", "session_timer_notification_expanded")


def fingerprint(stream):
    digest = hashlib.sha256()
    size = 0
    crc = 0
    while chunk := stream.read(CHUNK):
        size += len(chunk)
        crc = zlib.crc32(chunk, crc)
        digest.update(chunk)
    return {"bytes": size, "sha256": digest.hexdigest().upper(), "crc32": crc & 0xFFFFFFFF}


def find_strings(stream, needles):
    """Bounded streaming substring search, explicitly not class-definition parsing."""
    remaining = dict(needles)
    found = set()
    carry = b""
    overlap = max((len(value) for value in remaining.values()), default=1) - 1
    while chunk := stream.read(CHUNK):
        data = carry + chunk
        for name, value in list(remaining.items()):
            if value in data:
                found.add(name)
                del remaining[name]
        if not remaining:
            break
        carry = data[-overlap:] if overlap else b""
    return found


def verify(apk_path):
    if not apk_path.is_file() or apk_path.suffix.lower() != ".apk":
        raise ValueError("Input must be an existing APK file")
    with apk_path.open("rb") as source:
        apk = fingerprint(source)
    result = {"apk": str(apk_path.resolve()), "apkBytes": apk["bytes"], "apkSha256": apk["sha256"],
              "verificationScope": "ZIP CRC, exact bundled speech bytes, resource/DEX string presence only",
              "manifest": {"verified": False,
                           "reason": "No installed Android binary-manifest parser; package, versionName, versionCode and runtime are not verified by this script."},
              "signature": {"verified": False,
                            "reason": "ZIP CRC/SHA-256 do not verify APK v1/v2/v3 signing or identify its signer."}}
    errors = []
    with zipfile.ZipFile(apk_path, "r") as archive:
        infos = archive.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entry names make APK checks ambiguous")
        if any(info.flag_bits & 1 for info in infos):
            raise ValueError("Encrypted entries are not valid for these APK checks")
        # Refuse unreasonable decompression work; nothing is ever extracted.
        if sum(info.file_size for info in infos) > 8 * 1024**3:
            raise ValueError("Expanded ZIP exceeds the 8 GiB verification safety limit")
        bad_entry = archive.testzip()
        result["zipCrc"] = {"verified": bad_entry is None, "entriesChecked": len(infos), "badEntry": bad_entry}
        if bad_entry is not None:
            raise ValueError(f"ZIP CRC failed for {bad_entry}")
        result["manifest"]["present"] = "AndroidManifest.xml" in names
        if not result["manifest"]["present"]:
            errors.append("AndroidManifest.xml is missing")

        asset_root = Path(__file__).resolve().parents[1] / "assets" / "sounds" / "notifications"
        speech = []
        for filename in SOUNDS:
            with (asset_root / filename).open("rb") as source:
                expected = fingerprint(source)
            candidates = [info for info in infos if not info.is_dir()
                          and info.file_size == expected["bytes"] and info.CRC == expected["crc32"]]
            matches = []
            for info in candidates:
                with archive.open(info, "r") as source:
                    actual = fingerprint(source)
                if actual["sha256"] == expected["sha256"]:
                    matches.append(info.filename)
            # Require packaged Android res/ copies rather than only assets/.
            # This proves bytes are present, not the raw resource ID mapping.
            native_matches = [name for name in matches if name.startswith("res/")]
            speech.append({"source": filename, "bytes": expected["bytes"], "sha256": expected["sha256"],
                           "matchingEntries": matches, "nativeResourceEntries": native_matches,
                           "verified": bool(native_matches), "resourceIdMappingVerified": False})
            if not native_matches:
                errors.append(f"Native bundled speech missing or changed: {filename}")
        result["speech"] = speech

        dex_presence = {name: [] for name in CLASS_DESCRIPTORS}
        for info in infos:
            if not re.fullmatch(r"classes(?:\d+)?\.dex", info.filename):
                continue
            with archive.open(info, "r") as source:
                found = find_strings(source, {name: name.encode("ascii") for name in CLASS_DESCRIPTORS})
            for name in found:
                dex_presence[name].append(info.filename)
        result["dexStringPresence"] = dex_presence
        result["dexVerificationNote"] = "Descriptor strings are not proof of DEX class definitions or successful device execution."
        for name, matches in dex_presence.items():
            if not matches:
                errors.append(f"Required timer descriptor not found in DEX: {name}")

        named_layouts = [name for name in names if name.startswith("res/")
                         and any(Path(name).name == f"{layout}.xml" for layout in LAYOUT_NAMES)]
        resource_labels = set()
        if "resources.arsc" in names:
            needles = {f"{name}:{encoding}": name.encode(encoding)
                       for name in LAYOUT_NAMES for encoding in ("utf-8", "utf-16le")}
            with archive.open("resources.arsc", "r") as source:
                labels = find_strings(source, needles)
            resource_labels = {label.split(":", 1)[0] for label in labels}
        result["timerLayouts"] = {
            "namedXmlEntries": named_layouts, "compiledResourceNameStrings": sorted(resource_labels),
            "mappingVerified": False,
            "note": "AAPT may rename XML paths; resource labels are listed without parsing resource IDs or their obfuscated path mappings.",
        }
        result["v1SignatureEntries"] = [name for name in names
                                        if re.fullmatch(r"META-INF/[^/]+\.(?:RSA|DSA|EC)", name, re.IGNORECASE)]
    result["passed"] = not errors
    result["errors"] = errors
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path, help="Downloaded APK path")
    args = parser.parse_args()
    try:
        result = verify(args.apk)
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError, NotImplementedError) as error:
        print(json.dumps({"passed": False, "error": str(error)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
