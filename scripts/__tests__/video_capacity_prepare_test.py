"""Offline privacy, MP4 metadata, and resource-stop checks for the local pipeline."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("video_prepare", ROOT / "scripts/prepare-video-capacity-v14.py")
video = importlib.util.module_from_spec(spec)
spec.loader.exec_module(video)


def box(kind, data=b""):
    return struct.pack(">I4s", len(data)+8, kind) + data


def mp4(version=0, fast=True):
    header = b"\0"*12 + struct.pack(">II", 48000, 1178778) if version == 0 else b"\1\0\0\0" + b"\0"*16 + struct.pack(">IQ", 48000, 1178778)
    moov, mdat = box(b"moov", box(b"mvhd", header)), box(b"mdat", b"public-fixture")
    return box(b"ftyp", b"isom\0\0\0\0") + (moov+mdat if fast else mdat+moov)


class CapacityPrepareTest(unittest.TestCase):
    def setUp(self):
        parent = ROOT / "workspace-artifacts/video-capacity-20261003-v14/self-tests"
        parent.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=parent)
        self.directory = Path(self.temporary.name).resolve()
        self.assertTrue(self.directory.is_relative_to(parent.resolve()))

    def tearDown(self):
        # The absolute cleanup target was verified within the owned test folder.
        self.temporary.cleanup()

    def fixture(self):
        seed = self.directory / "seed"
        (seed / "files").mkdir(parents=True)
        data = mp4()
        sha = hashlib.sha256(data).hexdigest()
        (seed / "files" / (sha+".mp4")).write_bytes(data)
        item = {"mimeType": "video/mp4", "locale": "zh", "code": "1", "equipmentId": "0",
                "fileName": sha+".mp4", "sha256": sha, "size": len(data),
                "mediaInfo": {"durationSeconds": 24.56, "fullDecodePassed": True}}
        public = {"id": "0", "isActive": True, "deletedAt": None,
                  "videoUrlZh": "/api/media/8112421d-42e9-4aa1-9c8c-5c8127aad349/8112421d-42e9-4aa1-9c8c-5c8127aad349.mp4"}
        catalog = self.directory / "public-catalog.json"
        return seed, item, public, catalog

    def write_fixture(self, seed, items, public, catalog):
        (seed / "manifest.json").write_text(json.dumps({"items": items}), encoding="utf-8")
        catalog.write_text(json.dumps({"items": [public]}), encoding="utf-8")

    def test_private_archive_and_unpublished_items_never_open(self):
        seed, item, public, catalog = self.fixture()
        archived = {**item, "archiveOnly": True, "fileName": "missing-archive.mp4"}
        attachment = {**item, "mimeType": "application/octet-stream", "fileName": "never-open-private.bin"}
        unpublished = {**item, "equipmentId": "9", "fileName": "never-open-unpublished.mp4"}
        self.write_fixture(seed, [item, archived, attachment, unpublished], public, catalog)
        result = video.plan(seed, catalog)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["sourceDurationSeconds"], 1178778/48000)
        self.assertNotEqual(result[0]["sourceDurationSeconds"], 24.56)

    def test_hash_mutation_refuses_original(self):
        seed, item, public, catalog = self.fixture()
        self.write_fixture(seed, [item], public, catalog)
        (seed / "files" / item["fileName"]).write_bytes(b"x"*item["size"])
        with self.assertRaisesRegex(ValueError, "Seed hash/size"):
            video.plan(seed, catalog)

    def test_duplicate_binding_refused(self):
        seed, item, public, catalog = self.fixture()
        self.write_fixture(seed, [item, copy.deepcopy(item)], public, catalog)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            video.plan(seed, catalog)

    def test_deleted_equipment_excluded(self):
        seed, item, public, catalog = self.fixture()
        self.write_fixture(seed, [item], {**public, "deletedAt": "2026-10-02"}, catalog)
        with self.assertRaisesRegex(ValueError, "Empty"):
            video.plan(seed, catalog)

    def test_v0_v1_duration_and_faststart(self):
        for version in (0, 1):
            for fast in (False, True):
                path = self.directory / f"movie-{version}-{fast}.mp4"
                path.write_bytes(mp4(version, fast))
                result = video.mp4_info(path)
                self.assertEqual(result["durationSeconds"], 1178778/48000)
                self.assertEqual(result["fastStart"], fast)

    def test_landscape_portrait_and_no_upscale(self):
        self.assertEqual(video.dimensions(1920, 1080), (1280, 720))
        self.assertEqual(video.dimensions(1080, 1920), (720, 1280))
        self.assertEqual(video.dimensions(640, 360), (640, 360))

    def test_stop_prevents_any_child_process(self):
        (self.directory / "STOP-ENCODING").write_text("stop", encoding="ascii")
        with patch.object(video.subprocess, "Popen") as child:
            with self.assertRaises(InterruptedError):
                video.Runner("unused-local-ffmpeg", self.directory).run([])
            child.assert_not_called()

    def finalization_fixture(self):
        seed, item, public, catalog = self.fixture()
        self.write_fixture(seed, [item], public, catalog)
        planned = video.plan(seed, catalog)
        output = self.directory / "output"
        (output / "derivatives").mkdir(parents=True)
        derivative = b"prepared-public-video-fixture"
        sha = hashlib.sha256(derivative).hexdigest()
        (output / "derivatives" / (sha+".mp4")).write_bytes(derivative)
        entry = {**planned[0], "derivativeStorageName": sha+".mp4", "derivativeSha256": sha,
                 "derivativeSizeBytes": len(derivative), "durationSeconds": 24.602,
                 "visualReviewPassed": False}
        video.save(output / "manifest.json", {"complete": True, "entries": [entry], "totals": {}})
        video.save(output / "source-playback-durations.json", {"complete": True, "entries": [
            {"sourceSha256": item["sha256"], "sourcePlaybackDurationSeconds": 24.557875}]})
        review_path = output / "review.json"
        video.save(review_path, {"entries": [{"sourceSha256": item["sha256"], "passed": True,
            "reviewer": "synthetic-fixture-reviewer", "reviewedAt": "2026-10-03T00:00:00Z"}]})
        return output, planned, review_path

    def test_finalize_uses_original_browser_duration_without_encoding(self):
        output, planned, review_path = self.finalization_fixture()
        with patch.object(video.subprocess, "Popen") as child, patch("builtins.print"):
            video.finalize(output, planned, review_path)
            child.assert_not_called()
        result = json.loads((output / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(result["entries"][0]["sourcePlaybackDurationSeconds"], 24.557875)
        self.assertEqual(result["entries"][0]["derivativeDurationSeconds"], 24.602)
        self.assertTrue(result["visualReviewPassed"])

    def test_finalize_refuses_missing_visual_review_without_persisting(self):
        output, planned, review_path = self.finalization_fixture()
        before = (output / "manifest.json").read_bytes()
        video.save(review_path, {"entries": []})
        with self.assertRaisesRegex(ValueError, "Missing visual review"):
            video.finalize(output, planned, review_path)
        self.assertEqual((output / "manifest.json").read_bytes(), before)

    def test_finalize_refuses_derivative_tampering(self):
        output, planned, review_path = self.finalization_fixture()
        derivative = next((output / "derivatives").iterdir())
        derivative.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "changed after preparation"):
            video.finalize(output, planned, review_path)


if __name__ == "__main__":
    unittest.main()
