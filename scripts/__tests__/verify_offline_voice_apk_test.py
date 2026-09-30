import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

SCRIPT = Path(__file__).resolve().parents[1] / "verify-offline-voice-apk.py"
spec = importlib.util.spec_from_file_location("offline_apk_gate", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class OfflineApkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="offline-apk-gate-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.apk = self.root / "fixture.apk"
        self.inventory = self.root / "inventory.json"
        self.model = b"Synthetic model bytes for packaging tests only."
        self.tokens = b"token 1\n"
        self.hashes = {gate.MODEL: hashlib.sha256(self.model).hexdigest(), gate.TOKENS: hashlib.sha256(self.tokens).hexdigest()}
        self.write_inventory()

    def write_inventory(self):
        self.inventory.write_text(json.dumps({"files": [{"path": key, "sha256": value} for key, value in self.hashes.items()]}), encoding="utf-8")

    def archive(self, *, compression=zipfile.ZIP_STORED, omit=(), marker=True, model=None, duplicate=False, dex_header=b"dex\n035\0", marker_in_second=False):
        contents = {gate.MODEL: self.model if model is None else model, gate.TOKENS: self.tokens,
                    "classes.dex": dex_header + b"fixture" + (gate.DEX_MARKER if marker and not marker_in_second else b"")}
        if marker_in_second:
            contents["classes2.dex"] = dex_header + b"secondary" + (gate.DEX_MARKER if marker else b"")
        contents.update({f"lib/arm64-v8a/{name}": b"synthetic native fixture" for name in gate.REQUIRED_LIBRARIES})
        with zipfile.ZipFile(self.apk, "w") as archive:
            for name, data in contents.items():
                if name not in omit:
                    archive.writestr(name, data, compress_type=compression if name == gate.MODEL else zipfile.ZIP_DEFLATED)
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr(gate.MODEL, self.model)

    def verify(self):
        return gate.verify_apk(self.apk, self.inventory, expected_model_size=len(self.model))

    def test_valid_stored_assets_and_primary_native_marker_pass(self):
        self.archive()
        result = self.verify()
        self.assertTrue(result["ok"])
        self.assertEqual(result["modelCompression"], "ZIP_STORED")
        self.assertEqual(result["abis"], ["arm64-v8a"])
        self.assertEqual(result["dexMarkerFiles"], ["classes.dex"])

    def test_multidex_marker_passes(self):
        self.archive(marker_in_second=True)
        self.assertEqual(self.verify()["dexMarkerFiles"], ["classes2.dex"])

    def test_build14_deflated_model_is_rejected(self):
        self.archive(compression=zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(gate.VerificationError, "ZIP_STORED"):
            self.verify()

    def test_wrong_model_size_is_rejected(self):
        self.archive(model=self.model + b"extra")
        with self.assertRaisesRegex(gate.VerificationError, "model size"):
            self.verify()

    def test_same_size_tampered_model_is_rejected(self):
        self.archive(model=b"x" * len(self.model))
        with self.assertRaisesRegex(gate.VerificationError, "SHA-256 mismatch"):
            self.verify()

    def test_wrong_tokens_hash_is_rejected(self):
        self.archive()
        self.hashes[gate.TOKENS] = "0" * 64
        self.write_inventory()
        with self.assertRaisesRegex(gate.VerificationError, "SHA-256 mismatch"):
            self.verify()

    def test_missing_model_tokens_or_arm64_library_is_rejected(self):
        for missing in [gate.MODEL, gate.TOKENS, *[f"lib/arm64-v8a/{name}" for name in gate.REQUIRED_LIBRARIES]]:
            with self.subTest(missing=missing):
                self.archive(omit=[missing])
                with self.assertRaisesRegex(gate.VerificationError, "missing"):
                    self.verify()

    def test_duplicate_asset_is_rejected(self):
        self.archive(duplicate=True)
        with self.assertRaisesRegex(gate.VerificationError, "duplicate"):
            self.verify()

    def test_absent_native_module_marker_is_rejected(self):
        self.archive(marker=False)
        with self.assertRaisesRegex(gate.VerificationError, "descriptor marker"):
            self.verify()

    def test_non_dex_disguised_as_classes_is_rejected(self):
        self.archive(dex_header=b"not dex!")
        with self.assertRaisesRegex(gate.VerificationError, "DEX header"):
            self.verify()

    def test_no_primary_dex_is_rejected(self):
        self.archive(omit=["classes.dex"])
        with self.assertRaisesRegex(gate.VerificationError, "primary"):
            self.verify()

    def test_inventory_must_have_unique_exact_hash(self):
        self.archive()
        self.inventory.write_text(json.dumps({"files": [{"path": gate.MODEL, "sha256": self.hashes[gate.MODEL]}] * 2}), encoding="utf-8")
        with self.assertRaisesRegex(gate.VerificationError, "inventory hash"):
            self.verify()

    def test_large_dex_is_bounded(self):
        self.archive()
        previous = gate.MAX_DEX_SIZE
        gate.MAX_DEX_SIZE = 4
        try:
            with self.assertRaisesRegex(gate.VerificationError, "inspection bounds"):
                self.verify()
        finally:
            gate.MAX_DEX_SIZE = previous


if __name__ == "__main__":
    unittest.main()
