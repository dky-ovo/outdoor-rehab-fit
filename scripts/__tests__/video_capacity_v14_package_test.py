import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'package-video-capacity-v14.py'
spec = importlib.util.spec_from_file_location('capacity_package', SOURCE)
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageTest(unittest.TestCase):
    def setUp(self):
        workspace = SOURCE.parents[1].resolve()
        temporary_base = workspace / 'workspace-artifacts/video-capacity-20261003-v14/package-tests'
        self.assertTrue(temporary_base.resolve().is_relative_to(workspace))
        temporary_base.mkdir(parents=True, exist_ok=True)
        self.directory = tempfile.TemporaryDirectory(dir=temporary_base)
        self.assertTrue(Path(self.directory.name).resolve().is_relative_to(temporary_base.resolve()))
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.previous = {key: getattr(package, key) for key in ('ROOT', 'SUPPORT', 'OUT', 'CHECKSUM', 'BASELINE_PATH', 'BASELINE_SHA')}
        self.addCleanup(self.restore)
        package.ROOT = self.root
        package.SUPPORT = self.root / 'support'
        package.SUPPORT.mkdir()
        package.OUT = package.SUPPORT / 'capacity.tar.gz'
        package.CHECKSUM = package.SUPPORT / 'SHA256SUMS'
        package.BASELINE_PATH = self.root / 'baseline.tar.gz'
        for name in package.SERVER_FILES:
            path = self.root / 'server/src' / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('capacity fix ' + name)
        for name in package.SUPPORT_FILES:
            (package.SUPPORT / name).write_text('support ' + name)
        self.web = self.root / 'web'
        self.web.mkdir()
        (self.web / 'index.html').write_text('new index')
        (self.web / 'unchanged.css').write_text('same css')
        self.baseline_sources = {'server/src/appMysql.js': hashlib.sha256(b'old source').hexdigest(),
                                 'server/src/lastSeenPolicy.js': hashlib.sha256(b'sealed v13 policy').hexdigest()}
        (self.root / 'server/src/lastSeenPolicy.js').write_bytes(b'sealed v13 policy')
        self.baseline_web = {'web/index.html': hashlib.sha256(b'old index').hexdigest(),
                             'web/unchanged.css': hashlib.sha256(b'same css').hexdigest()}
        manifest = {'release': package.BASELINE_PREFIX, 'files': {'server/src/appMysql.js': self.baseline_sources['server/src/appMysql.js']},
                    'baselineSourceFiles': self.baseline_sources, 'webFiles': self.baseline_web}
        with tarfile.open(package.BASELINE_PATH, 'w:gz') as archive:
            for name, data in {'manifest.json': json.dumps(manifest).encode(), 'server/src/appMysql.js': b'old source'}.items():
                member = tarfile.TarInfo(package.BASELINE_PREFIX + '/' + name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
        package.BASELINE_SHA = package.digest(package.BASELINE_PATH.read_bytes())
        self.media = self.root / 'media'
        (self.media / 'derivatives').mkdir(parents=True)
        (self.media / 'derivatives/abc.mp4').write_bytes(b'encoded media')
        (self.media / 'manifest.json').write_text(json.dumps({'version': 1, 'complete': True,
            'entries': [{'visualReviewPassed': True}]}))
        (self.media / 'qa').mkdir()
        (self.media / 'qa/private-log.txt').write_text('QA is not a public deployment payload')

    def restore(self):
        for name, value in self.previous.items():
            setattr(package, name, value)

    def test_sealed_delta_reuses_only_attested_web_and_contains_six_server_fixes_and_media(self):
        package.seal(self.web, self.media)
        with tarfile.open(package.OUT, 'r:gz') as archive:
            manifest = json.load(archive.extractfile(package.PREFIX + '/manifest.json'))
            self.assertEqual(manifest['baselineImage'], package.BASELINE_IMAGE)
            self.assertEqual(manifest['baselineSourceFiles'], self.baseline_sources)
            self.assertEqual(manifest['baselineWebFiles'], self.baseline_web)
            self.assertNotIn('web/unchanged.css', manifest['files'])
            self.assertIn('web/unchanged.css', manifest['webFiles'])
            self.assertEqual({name for name in manifest['files'] if name.startswith('server/')},
                             {'server/src/' + name for name in package.SERVER_FILES})
            self.assertIn('media/manifest.json', manifest['files'])
            self.assertIn('media/derivatives/abc.mp4', manifest['files'])
            self.assertNotIn('media/qa/private-log.txt', manifest['files'])
            for name, expected in manifest['files'].items():
                self.assertEqual(package.digest(archive.extractfile(package.PREFIX + '/' + name).read()), expected)
        self.assertTrue(package.CHECKSUM.read_text().startswith(package.digest(package.OUT.read_bytes())))

    def test_existing_delivery_cannot_be_overwritten(self):
        package.OUT.write_bytes(b'keep original')
        with self.assertRaisesRegex(RuntimeError, 'PACKAGE_ALREADY_SEALED'):
            package.seal(self.web, self.media)
        self.assertEqual(package.OUT.read_bytes(), b'keep original')

    def test_changed_baseline_rejected_before_output_write(self):
        package.BASELINE_PATH.write_bytes(b'changed archive')
        with self.assertRaisesRegex(RuntimeError, 'BASELINE_ARCHIVE_CHANGED'):
            package.seal(self.web, self.media)
        self.assertFalse(package.OUT.exists())

    def test_private_web_content_refused(self):
        private = self.web / 'private'
        private.mkdir()
        (private / 'accounts.json').write_text('not public')
        with self.assertRaisesRegex(RuntimeError, 'PRIVATE_FILE_REFUSED'):
            package.seal(self.web, self.media)
        self.assertFalse(package.OUT.exists())

    def test_dependency_asset_exception_does_not_allow_dependency_source(self):
        package.safe_relative('web/assets/node_modules/font/regular.ttf')
        for name in ('web/assets/node_modules/x/package.json', '../outside', 'web/.env', 'web/test.docx'):
            with self.assertRaises(RuntimeError):
                package.safe_relative(name)

    def test_incomplete_and_unreviewed_media_refused(self):
        path = self.media / 'manifest.json'
        path.write_text(json.dumps({'version': 1, 'complete': False, 'entries': [{'visualReviewPassed': True}]}))
        with self.assertRaisesRegex(RuntimeError, 'MEDIA_ENCODING_INCOMPLETE'):
            package.seal(self.web, self.media)
        path.write_text(json.dumps({'version': 1, 'complete': True, 'entries': [{'visualReviewPassed': False}]}))
        with self.assertRaisesRegex(RuntimeError, 'MEDIA_VISUAL_REVIEW_REQUIRED'):
            package.seal(self.web, self.media)
        self.assertFalse(package.OUT.exists())

    def test_untouched_runtime_drift_is_refused(self):
        (self.root / 'server/src/lastSeenPolicy.js').write_bytes(b'changed by another task')
        with self.assertRaisesRegex(RuntimeError, 'UNRELATED_RUNTIME_SOURCE_DRIFT'):
            package.seal(self.web, self.media)
        self.assertFalse(package.OUT.exists())


if __name__ == '__main__':
    unittest.main()
