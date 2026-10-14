"""Server-key setup tests use synthetic values only; no cloud access."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('configure_v22', SOURCE / 'configure-bailian.py')
CONFIG = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONFIG)
SPEC = importlib.util.spec_from_file_location('install_v22_key_check', SOURCE / 'install.py')
INSTALL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALL)


class ServerKeyTests(unittest.TestCase):
    def test_new_secret_is_exclusive_and_has_no_trailing_newline_or_stdout(self):
        with tempfile.TemporaryDirectory(prefix='v22-key-test-') as temporary:
            target = Path(temporary) / 'synthetic-key'
            output = io.StringIO()
            with patch.object(CONFIG.os, 'O_NOFOLLOW', getattr(os, 'O_NOFOLLOW', 0), create=True), \
                 patch.object(CONFIG.os, 'fchown', create=True) as owner, \
                 patch.object(CONFIG.os, 'fchmod', create=True) as mode, contextlib.redirect_stdout(output):
                CONFIG.create_secret(target, 'synthetic-only-test-key')
                self.assertEqual(target.read_bytes(), b'synthetic-only-test-key')
                self.assertEqual(owner.call_args.args[1:], (1000, 1000))
                self.assertEqual(mode.call_args.args[1:], (0o400,))
                with self.assertRaises(FileExistsError):
                    CONFIG.create_secret(target, 'different-key')
                self.assertEqual(target.read_bytes(), b'synthetic-only-test-key')
            self.assertEqual(output.getvalue(), '')

    def test_invalid_key_is_rejected_before_file_creation(self):
        with patch.object(CONFIG.os, 'open') as opened:
            for value in ['', 'contains space', 'key\n', '\x00', 'x' * 4097, '中文']:
                with self.assertRaisesRegex(RuntimeError, '^BAILIAN_API_KEY_INVALID$'):
                    CONFIG.create_secret(Path('unused'), value)
            opened.assert_not_called()

    def test_existing_key_does_not_prompt_or_replace(self):
        with tempfile.TemporaryDirectory(prefix='v22-existing-key-') as temporary:
            base = Path(temporary); folder = base / 'secrets'; folder.mkdir()
            target = folder / CONFIG.NAME; target.write_text('existing-synthetic-key')
            output = io.StringIO()
            with patch.object(CONFIG, 'BASE', base), patch.object(CONFIG.os, 'geteuid', return_value=0, create=True), \
                 patch.object(CONFIG, 'check_directory'), patch.object(CONFIG, 'check_existing') as checked, \
                 patch.object(CONFIG.getpass, 'getpass') as prompt, contextlib.redirect_stdout(output):
                CONFIG.main()
                checked.assert_called_once_with(target); prompt.assert_not_called()
            self.assertEqual(target.read_text(), 'existing-synthetic-key')
            self.assertIn('BAILIAN_KEY=ALREADY_CONFIGURED', output.getvalue())
            self.assertNotIn('existing-synthetic-key', output.getvalue())

    def test_installer_checks_owner_mode_regular_file_and_size_without_reading_key(self):
        path = Mock()
        good = dict(st_mode=stat.S_IFREG | 0o400, st_uid=1000, st_gid=1000, st_nlink=1, st_size=128)
        with patch.object(INSTALL, 'below_base', return_value=path):
            path.stat.return_value = SimpleNamespace(**good)
            self.assertIs(INSTALL.bailian_secret(), path)
            for changes in [dict(st_mode=stat.S_IFREG | 0o644), dict(st_uid=0), dict(st_gid=0),
                            dict(st_nlink=2), dict(st_size=0), dict(st_size=4097), dict(st_mode=stat.S_IFDIR | 0o400)]:
                path.stat.return_value = SimpleNamespace(**{**good, **changes})
                with self.assertRaisesRegex(RuntimeError, '^UPDATE_BAILIAN_SECRET_METADATA_INVALID$'):
                    INSTALL.bailian_secret()
            path.read_text.assert_not_called(); path.read_bytes.assert_not_called()

    def test_setup_and_installer_do_not_write_provider_selection_or_contain_a_secret(self):
        setup = (SOURCE / 'configure-bailian.py').read_text()
        install = (SOURCE / 'install.py').read_text()
        self.assertNotIn('UPDATE ai_configuration', setup + install)
        self.assertNotIn('INSERT INTO ai_configuration', setup + install)
        self.assertIn('getpass.getpass', setup)
        self.assertIn("'BAILIAN_FAQ_ENABLED': 'false'", install)
        self.assertIn("'DASHSCOPE_API_KEY_FILE': '/run/secrets/dashscope-api-key'", install)


if __name__ == '__main__':
    unittest.main()
