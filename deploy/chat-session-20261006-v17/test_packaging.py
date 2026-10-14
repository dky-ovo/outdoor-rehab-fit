"""Validate actual sealed baselines and payload declarations without exporting."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PackagingTests(unittest.TestCase):
    def test_both_declared_sources_are_derived_from_actual_sealed_archives(self):
        package = load('v17_packager', ROOT / 'scripts/package-chat-session-v17.py')
        installer = load('v17_installer', Path(__file__).with_name('install.py'))
        known = package.baselines()
        self.assertEqual(set(known), {'v15', 'v16'})
        for name, baseline in known.items():
            self.assertEqual(installer.BASELINE_SOURCES[name], {key: baseline['sourceFiles'].get(key) for key in installer.UPDATE_SOURCE})
            self.assertEqual(installer.BASELINE_WEB_DIGESTS[name], installer.web_digest(baseline['webFiles']))
            self.assertNotIn('server/src/assistantContentPolicy.js', baseline['sourceFiles'])
            self.assertIn('server/src/app.js', baseline['sourceFiles'])
        self.assertEqual(installer.NEW_SOURCE, {'server/src/assistantContentPolicy.js'})
        self.assertNotIn('server/src/assistantDeadline.js', known['v15']['sourceFiles'])
        self.assertIn('server/src/assistantDeadline.js', known['v16']['sourceFiles'])

    def test_both_served_web_baselines_include_retained_older_assets(self):
        package = load('v17_packager_web', ROOT / 'scripts/package-chat-session-v17.py')
        known = package.baselines()
        for key, folder in [('v15', 'ai-faq-20261006-v15'), ('v16', 'ai-sync-keyboard-20261006-v16')]:
            manifest = package.sealed_manifest(folder, 'outdoor-fit-' + folder)
            web = known[key]['webFiles']
            self.assertEqual(web, {**manifest['baselineWebFiles'], **manifest['webFiles']})
            retained = set(manifest['baselineWebFiles']) - set(manifest['webFiles'])
            self.assertTrue(retained)
            for name in retained:
                self.assertEqual(web[name], manifest['baselineWebFiles'][name])


if __name__ == '__main__':
    unittest.main()
