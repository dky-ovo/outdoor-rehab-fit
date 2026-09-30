"""Exercise the exact installer ZIP extractor in disposable directories, never a service."""
import pathlib
import re
import stat
import sys
import tempfile
import unittest
import warnings
import zipfile


TEMPLATE = pathlib.Path(__file__).resolve().parents[1] / "install-participant-facility-learning-20260922.sh.in"
SOURCE = re.search(r"<<'PY'\n(.*?)\nPY\n", TEMPLATE.read_text(encoding="utf-8"), re.S).group(1)
MEMBERS = ["app.js", "database.js", "learningProgress.js", "install-participant-facility-learning-20260922.sh",
           "verify-participant-facility-learning-release.cjs", "release-manifest.json", "README.md"]


class ArchiveSafety(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="pfl-extract-test-")
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.assertEqual(self.root.parent, pathlib.Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith("pfl-extract-test-"))
        self.archive = self.root / "release.zip"
        self.destination = self.root / "extracted"
        self.destination.mkdir()

    def tearDown(self):
        self.assertEqual(self.root.parent, pathlib.Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith("pfl-extract-test-"))
        self.temporary.cleanup()

    def create(self, entries):
        with warnings.catch_warnings(), zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            warnings.simplefilter("ignore", UserWarning)
            for name, contents in entries:
                archive.writestr(name, contents)

    def extract(self):
        original = sys.argv
        try:
            sys.argv = ["extractor", str(self.archive), str(self.destination)]
            exec(compile(SOURCE, "<installer-extractor>", "exec"), {"__name__": "__main__"})
        finally:
            sys.argv = original

    def rejection(self, entries):
        self.create(entries)
        with self.assertRaises((RuntimeError, zipfile.BadZipFile)):
            self.extract()
        self.assertEqual(list(self.destination.iterdir()), [])

    def test_only_seven_fixed_regular_files_extract(self):
        self.create([(name, b"test") for name in MEMBERS])
        self.extract()
        self.assertEqual(sorted(path.name for path in self.destination.iterdir()), sorted(MEMBERS))

    def test_extra_or_traversal_members_are_rejected_before_writes(self):
        for unsafe in ["../escape", "/outside", "src/app.js", "secret.env", "app\\other.js"]:
            with self.subTest(unsafe=unsafe):
                self.rejection([(name, b"test") for name in MEMBERS] + [(unsafe, b"bad")])

    def test_duplicate_members_are_rejected(self):
        self.rejection([(name, b"test") for name in MEMBERS] + [("app.js", b"duplicate")])

    def test_missing_member_is_rejected(self):
        self.rejection([(name, b"test") for name in MEMBERS[:-1]])

    def test_archive_symlink_is_rejected(self):
        link = zipfile.ZipInfo("app.js")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.rejection([(link if name == "app.js" else name, b"target") for name in MEMBERS])

    def test_archive_device_is_rejected(self):
        device = zipfile.ZipInfo("app.js")
        device.create_system = 3
        device.external_attr = (stat.S_IFCHR | 0o600) << 16
        self.rejection([(device if name == "app.js" else name, b"target") for name in MEMBERS])

    def test_oversize_and_empty_payloads_are_rejected(self):
        for contents in [b"", b"0" * (2 * 1024 * 1024 + 1)]:
            self.rejection([(name, contents if name == "app.js" else b"test") for name in MEMBERS])


if __name__ == "__main__":
    unittest.main()
