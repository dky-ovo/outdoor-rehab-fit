"""Run the exact Web-only installer ZIP extractor in disposable directories."""
import pathlib
import re
import stat
import sys
import tempfile
import unittest
import warnings
import zipfile

TEMPLATE = pathlib.Path(__file__).resolve().parents[1] / "install-team-about-20260924.sh.in"
SOURCE = re.search(r"<<'PY'\n(.*?)\nPY\n", TEMPLATE.read_text(encoding="utf-8"), re.S).group(1)
MEMBERS = ["install-team-about-20260924.sh", "verify-team-about-release.cjs",
           "release-manifest.json", "README.md", "appTextCatalog.json", "web/index.html", "web/assets/example.js"]

class ArchiveSafety(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="team-about-extract-test-")
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.assertEqual(self.root.parent, pathlib.Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith("team-about-extract-test-"))
        self.archive = self.root / "release.zip"
        self.destination = self.root / "extracted"
        self.destination.mkdir()

    def tearDown(self):
        self.assertEqual(self.root.parent, pathlib.Path(tempfile.gettempdir()).resolve())
        self.assertTrue(self.root.name.startswith("team-about-extract-test-"))
        self.temporary.cleanup()

    def create(self, entries):
        with warnings.catch_warnings(), zipfile.ZipFile(self.archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            warnings.simplefilter("ignore", UserWarning)
            for name, contents in entries:
                if isinstance(name, str) and '\\' in name:
                    # ZipInfo normally normalizes Windows separators. Preserve
                    # the hostile raw member name to exercise the Linux parser.
                    raw = zipfile.ZipInfo("placeholder")
                    raw.filename = name
                    name = raw
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

    def test_fixed_root_and_web_members_extract(self):
        self.create([(name, b"test") for name in MEMBERS])
        self.extract()
        self.assertEqual(sorted(p.relative_to(self.destination).as_posix() for p in self.destination.rglob('*') if p.is_file()), sorted(MEMBERS))

    def test_extra_or_traversal_members_rejected_before_writes(self):
        for unsafe in ["../escape", "/outside", "src/app.js", "secret.env", "web/../escape", "web/.private", "web\\other.js"]:
            with self.subTest(unsafe=unsafe):
                self.rejection([(name, b"test") for name in MEMBERS] + [(unsafe, b"bad")])

    def test_duplicate_members_rejected(self):
        self.rejection([(name, b"test") for name in MEMBERS] + [("README.md", b"duplicate")])

    def test_missing_root_or_web_entrypoint_rejected(self):
        for missing in ["README.md", "web/index.html"]:
            self.rejection([(name, b"test") for name in MEMBERS if name != missing])

    def test_symlink_and_device_members_rejected(self):
        for kind in [stat.S_IFLNK, stat.S_IFCHR]:
            entry = zipfile.ZipInfo("README.md")
            entry.create_system = 3
            entry.external_attr = (kind | 0o777) << 16
            self.rejection([(entry if name == "README.md" else name, b"target") for name in MEMBERS])

    def test_oversize_and_empty_root_rejected(self):
        for content in [b"", b"0" * (8 * 1024 * 1024 + 1)]:
            self.rejection([(name, content if name == "README.md" else b"test") for name in MEMBERS])

    def test_file_directory_collision_rejected_before_writes(self):
        self.rejection([(name, b"test") for name in MEMBERS] + [("web/assets", b"conflict")])

    def test_directory_mismatched_mode_rejected(self):
        entry = zipfile.ZipInfo("web/assets/example.js")
        entry.create_system = 3
        entry.external_attr = (stat.S_IFDIR | 0o755) << 16
        self.rejection([(entry if name == entry.filename else name, b"test") for name in MEMBERS])

if __name__ == "__main__":
    unittest.main()

