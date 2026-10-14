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
    def test_declared_v15_source_is_derived_from_sealed_v14_and_v15(self):
        package = load('v16_packager', ROOT / 'scripts/package-ai-sync-keyboard-v16.py')
        installer = load('v16_installer', Path(__file__).with_name('install.py'))
        source, _ = package.baselines()
        self.assertEqual(installer.BASELINE_SOURCE, {name: source[name] for name in installer.BASELINE_SOURCE})
        self.assertEqual(installer.NEW_SOURCE, {'server/src/assistantDeadline.js'})
        self.assertNotIn('server/src/assistantDeadline.js', source)

    def test_v15_real_served_web_retains_older_assets_in_the_baseline(self):
        package = load('v16_packager_web', ROOT / 'scripts/package-ai-sync-keyboard-v16.py')
        v15 = package.sealed_manifest('ai-faq-20261006-v15', 'outdoor-fit-ai-faq-20261006-v15')
        _, web = package.baselines()
        self.assertEqual(web, {**v15['baselineWebFiles'], **v15['webFiles']})
        retained = set(v15['baselineWebFiles']) - set(v15['webFiles'])
        self.assertTrue(retained)
        for name in retained:
            self.assertEqual(web[name], v15['baselineWebFiles'][name])


if __name__ == '__main__':
    unittest.main()
