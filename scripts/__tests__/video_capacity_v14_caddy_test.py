"""Verify real Caddy cache headers on a local synthetic web fixture only."""
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('video_install', ROOT / 'deploy/video-capacity-20261003-v14/install.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
CADDY = ROOT / 'workspace-artifacts/video-capacity-20261003-v14/qa-tools/caddy-2.11.4/caddy.exe'


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class CacheHeaderTest(unittest.TestCase):
    def test_successful_hashed_assets_only_are_immutable(self):
        self.assertTrue(CADDY.is_file())
        base = ROOT / 'workspace-artifacts/video-capacity-20261003-v14'
        with tempfile.TemporaryDirectory(prefix='caddy-local-', dir=base) as folder:
            fixture = Path(folder).resolve()
            self.assertTrue(fixture.is_relative_to(base.resolve()))
            web = fixture / 'web'
            web.mkdir()
            (web / 'index.html').write_text('<html>v14 synthetic fixture</html>')
            js = '_expo/static/js/web/entry-' + 'a' * 32 + '.js'
            font = 'assets/Font.' + 'b' * 32 + '.ttf'
            for name in (js, font, 'plain.js'):
                target = web / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'fixture bytes')
            ports = [free_port(), free_port()]
            original = '{\n admin off\n auto_https off\n}\n' + '\n'.join(
                'http://127.0.0.1:' + str(port) + ' {\n root * /srv/admin\n try_files {path} /index.html\n'
                ' header Cache-Control "no-cache"\n file_server\n}' for port in ports)
            config = MOD.patch_caddy(original).replace('/srv/admin', '"' + web.as_posix() + '"')
            path = fixture / 'Caddyfile'
            path.write_text(config)
            with (fixture / 'caddy.log').open('wb') as log:
                process = subprocess.Popen([str(CADDY), 'run', '--config', str(path), '--adapter', 'caddyfile'],
                                           stdout=log, stderr=log)
                try:
                    origin = 'http://127.0.0.1:' + str(ports[0])
                    for _ in range(60):
                        try:
                            urllib.request.urlopen(origin + '/', timeout=0.25).close()
                            break
                        except OSError:
                            if process.poll() is not None:
                                self.fail('Caddy failed to start')
                            time.sleep(0.05)
                    observations = []
                    for route, expected in [(js, 'public, max-age=31536000, immutable'),
                                            (font, 'public, max-age=31536000, immutable'),
                                            ('plain.js', 'no-cache'), ('', 'no-cache'),
                                            ('outdoor/detail', 'no-cache'),
                                            ('_expo/static/js/web/missing-' + 'c' * 32 + '.js', 'no-cache')]:
                        with urllib.request.urlopen(origin + '/' + route, timeout=3) as response:
                            value = response.headers.get('Cache-Control')
                            observations.append({'path': route, 'status': response.status, 'cacheControl': value})
                            self.assertEqual(value, expected, route)
                    (base / 'qa-caddy-cache-headers.json').write_text(json.dumps({'passed': True, 'responses': observations}, indent=2))
                finally:
                    process.terminate()
                    process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
