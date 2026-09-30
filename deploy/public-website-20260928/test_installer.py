"""Offline safety checks for the installer; no Docker/network calls."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.dont_write_bytecode = True
import install


class InstallerSafety(unittest.TestCase):
    def test_reject_private_and_escape_paths(self):
        for name in ['../index.html', '/etc/passwd', 'assets/../../secret', 'a\\b.png',
                     '.env', 'assets/.git/config', 'secrets/index.html', 'id_rsa',
                     'certificate.pem', 'database.sqlite', 'installer.py', 'app.js.map', 'C:/foo']:
            with self.subTest(name=name), self.assertRaises(install.Failure):
                install.safe_relative(name)
        for name in ['index.html', 'assets/logo.svg', 'download/OUTDOOR Fit.pdf', 'team/cindy.jpg']:
            install.safe_relative(name)

    def test_literal_dollars_preserved_for_compose(self):
        value = {'services': {'caddy': {'environment': {'KEY': 'prefix${UNEXPECTED}$suffix'}}}}
        escaped = install.literal_compose(value)
        self.assertEqual(escaped['services']['caddy']['environment']['KEY'], 'prefix$${UNEXPECTED}$$suffix')
        self.assertEqual(value['services']['caddy']['environment']['KEY'], 'prefix${UNEXPECTED}$suffix')

    def test_only_caddy_is_recreated(self):
        with patch.object(install, 'command', return_value=b'') as call:
            install.up(Path('/private/config.json'))
        args = call.call_args.args[0]
        self.assertEqual(args[-1], 'caddy')
        self.assertNotIn('api', args)
        for option in ['--no-deps', '--no-build', '--force-recreate']:
            self.assertIn(option, args)
        self.assertEqual(args[args.index('--pull') + 1], 'never')

    def test_manifest_requires_exact_payload(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            package = Path(folder)
            website = package / 'website'
            website.mkdir()
            content = b'<html>Public website</html>'
            (website / 'index.html').write_bytes(content)
            manifest = {'format': 1, 'files': {'index.html': {
                'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)}}}
            (package / 'website-manifest.json').write_text(json.dumps(manifest))
            with patch.object(install, 'PACKAGE', package), patch.object(install, 'WEBSITE', website):
                self.assertEqual(set(install.website_files()), {'index.html'})
                (website / 'extra.txt').write_text('unexpected')
                with self.assertRaisesRegex(install.Failure, 'FILESET_MISMATCH'):
                    install.website_files()
                (website / 'extra.txt').unlink()
                (website / 'index.html').write_bytes(b'<html>changed</html>')
                with self.assertRaisesRegex(install.Failure, 'HASH_MISMATCH'):
                    install.website_files()

    def test_probe_is_internal_and_www_is_canonical(self):
        self.assertIn('http://:8099 {\n    bind 127.0.0.1', install.BLOCK)
        self.assertIn('redir https://outdoorfit.hk{uri} 308', install.BLOCK)
        self.assertEqual(install.BLOCK.count('root * /srv/website'), 1)
        self.assertEqual(install.BLOCK.count('import outdoor_public_site_20260928'), 2)

    def test_existing_html_change_fails_verification(self):
        replies = [b'{"ok":true,"service":"outdoor-fit-api"}', b'<html>changed</html>', b'<html>admin</html>']
        with patch.object(install, 'command', side_effect=replies):
            with self.assertRaisesRegex(install.Failure, 'APP_CONTENT_CHANGED'):
                install.verify_existing({'https://app.outdoorfit.hk/': 'old', 'https://admin.outdoorfit.hk/admin': 'old'})


if __name__ == '__main__':
    unittest.main()
