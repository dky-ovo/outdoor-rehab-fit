"""Synthetic installer checks. Never calls Docker, SSH, a database, or production."""
import argparse
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('install.py')
SPEC = importlib.util.spec_from_file_location('load_capacity_install', SOURCE)
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
REAL_RUN = MOD.run
REAL_VERIFY_PUBLIC_WEB = MOD.verify_public_web
WORKSPACE = SOURCE.resolve().parents[2]
SECRET = 'SYNTHETIC_PRIVATE_$VALUE'
API_ID, CADDY_ID, NEW_ID = ('sha256:' + character * 64 for character in ('1', '2', '3'))


def unliteral(value):
    if isinstance(value, str):
        return value.replace('$$', '$')
    if isinstance(value, dict):
        return {key: unliteral(item) for key, item in value.items()}
    if isinstance(value, list):
        return [unliteral(item) for item in value]
    return value


class FakeHost:
    def __init__(self, root):
        self.base, self.package = root / 'production', root / 'package'
        self.state = self.base / '.update-state' / ('load-capacity-' + MOD.TAG)
        self.release = self.base / 'releases' / MOD.PREFIX
        self.base.mkdir(); self.package.mkdir()
        self.web = self.base / 'releases' / 'v12' / 'web'
        self.web.mkdir(parents=True)
        (self.web / 'index.html').write_bytes(b'<html>baseline</html>')
        (self.web / 'reused.js').write_bytes(b'baseline cached asset')
        (self.base / 'live.json').write_text('{}')
        self.config = {'name': MOD.PROJECT, 'services': {
            'api': {'image': MOD.BASELINE_IMAGE, 'environment': {
                'MYSQL_POOL_SIZE': '4', 'JWT_SECRET': SECRET, 'TEMP_TEST_USERS_ENABLED': 'true'},
                'volumes': [{'type': 'bind', 'source': str(self.base / 'secret-file'),
                             'target': '/run/outdoor-secrets/jwt-secret', 'read_only': True}]},
            'caddy': {'image': 'caddy:synthetic', 'environment': {'ACME_EMAIL': 'synthetic@example.test'},
                'volumes': [{'type': 'bind', 'source': str(self.web), 'target': '/srv/admin', 'read_only': True}]}}}
        (self.base / 'live.json').write_text(json.dumps(self.config))
        self.containers = {}
        for index, service in enumerate(('api', 'caddy')):
            config = self.config['services'][service]
            self.containers[service] = {
                'Id': str(index + 6) * 64, 'Image': API_ID if service == 'api' else CADDY_ID,
                'State': {'Running': True},
                'Config': {'Image': config['image'], 'Env': [key + '=' + item for key, item in config['environment'].items()],
                    'Cmd': ['node', 'src/production.js'] if service == 'api' else ['caddy', 'run'],
                    'Entrypoint': ['docker-entrypoint.sh'], 'User': '1000:1000', 'WorkingDir': '/app',
                    'ExposedPorts': {'3000/tcp': {}},
                    'Labels': {'com.docker.compose.project': MOD.PROJECT, 'com.docker.compose.service': service,
                               'com.docker.compose.project.config_files': str(self.base / 'live.json')}},
                'Mounts': [{'Type': 'bind', 'Source': item['source'], 'Destination': item['target'], 'RW': False}
                           for item in config['volumes']],
                'HostConfig': {'Memory': 1610612736, 'NanoCpus': 1500000000, 'NetworkMode': MOD.PROJECT + '_default'}}
        self.old = copy.deepcopy(self.containers)
        self.images = {MOD.BASELINE_IMAGE: API_ID, 'caddy:synthetic': CADDY_ID, API_ID: API_ID, CADDY_ID: CADDY_ID}
        self.commands, self.activations = [], []
        self.fail_service = None
        source_files = {name: MOD.digest(('baseline:' + name).encode())
                        for name in MOD.SOURCE_DELTA if not name.endswith('lastSeenPolicy.js')}
        self.live_sources = {name.removeprefix('server/src/'): checksum for name, checksum in source_files.items()}
        self.files = {}
        for name in MOD.SOURCE_DELTA | MOD.SUPPORT_FILES:
            path = self.package / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(('target:' + name).encode())
            self.files[name] = MOD.digest(path.read_bytes())
        (self.package / 'web').mkdir()
        (self.package / 'web/index.html').write_bytes(b'<html>v13</html>')
        self.files['web/index.html'] = MOD.digest((self.package / 'web/index.html').read_bytes())
        baseline_web = MOD.inventory(self.web, 'web/')
        self.manifest = {'release': MOD.PREFIX, 'baselineImage': MOD.BASELINE_IMAGE,
            'baselineArchiveSha256': MOD.BASELINE_ARCHIVE_SHA256, 'files': self.files,
            'baselineSourceFiles': source_files, 'baselineWebFiles': baseline_web,
            'webFiles': {**baseline_web, 'web/index.html': self.files['web/index.html']}}
        self.write_manifest()

    def write_manifest(self):
        (self.package / 'manifest.json').write_text(json.dumps(self.manifest))

    def inspect(self, name):
        service = next(service for service, expected in MOD.CONTAINERS.items() if name == expected)
        return copy.deepcopy(self.containers[service])

    def image_id(self, reference):
        return self.images[reference]

    def run(self, args, timeout=180):
        self.commands.append(args)
        if args[:3] == ['docker', 'image', 'ls']:
            return self.images.get(args[-1], '')
        if args[:2] == ['docker', 'tag']:
            self.images[args[-1]] = args[-2]
            return ''
        if args[:2] == ['docker', 'build']:
            assert 'BASE_IMAGE=' + MOD.BASE_ALIAS in args
            assert self.images[MOD.BASE_ALIAS] == API_ID
            assert '--pull=false' in args
            self.images[MOD.IMAGE] = NEW_ID; self.images[NEW_ID] = NEW_ID
            return ''
        if args[:2] == ['docker', 'ps']:
            return 'abcdef123456'
        if args[:2] == ['docker', 'exec']:
            assert 'walk(root)' in args[-1]
            return json.dumps(self.live_sources)
        if args[:2] == ['docker', 'compose']:
            path = Path(args[args.index('-f') + 1])
            config = unliteral(json.loads(path.read_text()))
            if 'config' in args:
                return json.dumps(config)
            assert 'up' in args and '--no-deps' in args and '--no-build' in args and '--pull' in args
            service = args[-1]
            self.activations.append((path.name, service))
            state = self.containers[service]
            definition = config['services'][service]
            state['Image'] = self.images[definition['image']]
            state['Id'] = 'a' * 64 if service == 'api' else 'b' * 64
            state['Config']['Image'] = definition['image']
            state['Config']['Env'] = [key + '=' + item for key, item in definition.get('environment', {}).items()]
            state['Config']['Labels']['com.docker.compose.project.config_files'] = str(path)
            for mount in state['Mounts']:
                matching = next(item for item in definition['volumes'] if item['target'] == mount['Destination'])
                mount['Source'] = matching['source']
            if self.fail_service == service:
                self.fail_service = None
                raise RuntimeError('UPDATE_SYNTHETIC_ACTIVATION_FAILURE')
            return ''
        raise AssertionError('Unexpected external command: ' + repr(args))


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.load-capacity-installer-test-', dir=WORKSPACE)
        root = Path(self.temp.name).resolve()
        self.assertEqual(root.parent, WORKSPACE)
        self.addCleanup(self.temp.cleanup)
        self.host = FakeHost(root)
        self.output = io.StringIO()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        for name, value in {'BASE': self.host.base, 'STATE': self.host.state, 'RELEASE': self.host.release,
                            'PACKAGE': self.host.package}.items():
            stack.enter_context(patch.object(MOD, name, value))
        stack.enter_context(patch.object(MOD, 'run', self.host.run))
        stack.enter_context(patch.object(MOD, 'inspect', self.host.inspect))
        stack.enter_context(patch.object(MOD, 'image_id', self.host.image_id))
        stack.enter_context(patch.object(MOD, 'health', lambda: None))
        stack.enter_context(patch.object(MOD, 'verify_public_web', lambda: None))
        stack.enter_context(contextlib.redirect_stdout(self.output))

    def test_check_only_leaves_no_state_release_or_service_changes(self):
        MOD.install(check_only=True)
        self.assertFalse(self.host.state.exists()); self.assertFalse(self.host.release.exists())
        self.assertEqual(self.host.activations, [])
        self.assertFalse(any(args[:2] in (['docker', 'tag'], ['docker', 'build']) for args in self.host.commands))
        self.assertIn('LOAD_CAPACITY_PREFLIGHT=PASS', self.output.getvalue())

    def test_exact_baseline_and_source_hash_mismatch_fail_before_staging(self):
        self.host.containers['api']['Config']['Image'] = 'outdoor-fit-api:20260930-v11'
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_EXACT_V12_BASELINE_REQUIRED'):
            MOD.install()
        self.host.containers['api']['Config']['Image'] = MOD.BASELINE_IMAGE
        self.host.live_sources['unexpected.js'] = '0' * 64
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_LIVE_SOURCE_BASELINE_MISMATCH'):
            MOD.install()
        self.assertFalse(self.host.state.exists()); self.assertEqual(self.host.activations, [])

    def test_web_hash_mismatch_and_existing_base_alias_fail_before_staging(self):
        original = (self.host.web / 'index.html').read_bytes()
        (self.host.web / 'index.html').write_bytes(b'unknown live change')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_LIVE_WEB_BASELINE_MISMATCH'):
            MOD.install()
        (self.host.web / 'index.html').write_bytes(original)
        self.host.images[MOD.BASE_ALIAS] = API_ID
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_TARGET_IMAGE_ALREADY_EXISTS'):
            MOD.install()
        self.assertFalse(self.host.state.exists()); self.assertEqual(self.host.activations, [])

    def test_package_tamper_or_database_payload_is_refused(self):
        path = self.host.package / 'server/src/mysqlConfig.js'
        original = path.read_bytes(); path.write_bytes(b'tampered')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_HASH_MISMATCH'):
            MOD.install()
        path.write_bytes(original)
        extra = self.host.package / 'schema.sql'; extra.write_bytes(b'ALTER TABLE users')
        self.host.manifest['files']['schema.sql'] = MOD.digest(extra.read_bytes()); self.host.write_manifest()
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_PAYLOAD_FILESET_INVALID'):
            MOD.install()
        self.assertEqual(self.host.commands, [])

    def test_success_preserves_secrets_mounts_and_feature_flags_and_prepares_exact_rollback(self):
        MOD.install()
        self.assertEqual(self.host.activations, [('api.json', 'api'), ('caddy.json', 'caddy')])
        new = unliteral(json.loads((self.host.state / 'api.json').read_text()))
        self.assertEqual(new['services']['api']['environment'], {
            'MYSQL_POOL_SIZE': '4', 'MYSQL_POOL_QUEUE_LIMIT': '128', 'JWT_SECRET': SECRET, 'TEMP_TEST_USERS_ENABLED': 'true'})
        self.assertEqual(new['services']['api']['volumes'], self.host.config['services']['api']['volumes'])
        self.assertEqual((self.host.release / 'web/reused.js').read_bytes(), (self.host.web / 'reused.js').read_bytes())
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        MOD.recovery_guard(recovery, MOD.observe_recovery())
        MOD.guarded_rollback(recovery, ['api', 'caddy'])
        self.assertEqual(self.host.containers['api']['Image'], API_ID)
        self.assertEqual(self.host.containers['caddy']['Image'], CADDY_ID)
        self.assertEqual(self.host.containers['api']['Config']['Env'], self.host.old['api']['Config']['Env'])
        self.assertEqual(self.host.containers['caddy']['Mounts'], self.host.old['caddy']['Mounts'])
        MOD.recovery_guard(recovery, MOD.observe_recovery())
        self.assertNotIn(SECRET, self.output.getvalue())
        self.assertFalse(any('migrate' in ' '.join(args) or args[:2] == ['docker', 'run'] for args in self.host.commands))

    def test_partial_activation_failure_rolls_back_every_attempted_service(self):
        self.host.fail_service = 'caddy'
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_SYNTHETIC_ACTIVATION_FAILURE'):
            MOD.install()
        self.assertEqual(self.host.activations, [('api.json', 'api'), ('caddy.json', 'caddy'),
                                                ('rollback-api.json', 'api'), ('rollback-caddy.json', 'caddy')])
        self.assertEqual(self.host.containers['api']['Image'], API_ID)
        self.assertEqual(self.host.containers['caddy']['Mounts'], self.host.old['caddy']['Mounts'])
        self.assertEqual(json.loads((self.host.state / 'report.json').read_text())['status'], 'activation_failed_rolled_back')

    def test_later_environment_change_blocks_rollback_before_service_mutations(self):
        MOD.install()
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        self.host.containers['api']['Config']['Env'].append('LATER_RELEASE=true')
        before = list(self.host.activations)
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_LATER_DEPLOYMENT_PRESENT'):
            MOD.guarded_rollback(recovery, ['api', 'caddy'])
        self.assertEqual(self.host.activations, before)

    def test_recovery_config_or_old_web_tampering_blocks_rollback(self):
        MOD.install()
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        path = self.host.state / 'rollback-api.json'
        original = path.read_bytes(); path.write_bytes(b'changed')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_RECOVERY_CONFIG_CHANGED'):
            MOD.guarded_rollback(recovery, ['api'])
        path.write_bytes(original)
        (self.host.web / 'index.html').write_bytes(b'unknown change')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_ROLLBACK_WEB_BASELINE_CHANGED'):
            MOD.guarded_rollback(recovery, ['api'])
        self.assertEqual(len(self.host.activations), 2)

    def test_literal_compose_and_bounded_queue_preserve_values_without_unlimited_queue(self):
        value = {'key': 'plain$VALUE$$tail', 'items': ['${NOT_AN_ENV_REFERENCE}']}
        self.assertEqual(unliteral(MOD.literal_compose(value)), value)
        self.assertEqual(MOD.bounded_queue('1'), 1); self.assertEqual(MOD.bounded_queue('256'), 256)
        for value in ('0', '257', '-1', '1.5', SECRET, ' 4', '4 ', '1000'):
            with self.assertRaises(argparse.ArgumentTypeError):
                MOD.bounded_queue(value)
        for value in (0, 257, True, '128'):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_QUEUE_LIMIT_INVALID'):
                MOD.configure_capacity(self.host.config, value)
        for name in ('../schema.sql', '/schema.sql', 'web/.env', 'web/private.key', 'web/../index.html'):
            with self.assertRaises(RuntimeError):
                MOD.safe_name(name)

    def test_command_failure_never_prints_private_stdout_or_stderr(self):
        # Invoke the real helper while intercepting subprocess itself. It must
        # expose only an internal fixed code, even on a secret-bearing failure.
        with patch.object(MOD.subprocess, 'run', return_value=SimpleNamespace(
                returncode=1, stdout=SECRET, stderr='SQL ' + SECRET)):
            with self.assertRaisesRegex(RuntimeError, '^UPDATE_COMMAND_FAILED$') as context:
                REAL_RUN(['docker', 'inspect', 'synthetic'])
        self.assertNotIn(SECRET, str(context.exception) + self.output.getvalue())

    def test_public_readiness_retries_only_get_requests_and_checks_html(self):
        self.host.release.mkdir(parents=True)
        (self.host.release / 'web').mkdir()
        (self.host.release / 'web/index.html').write_bytes(b'<html>v13</html>')
        calls = []
        def fetch(args, timeout=180):
            calls.append(args)
            self.assertIn('--retry', args); self.assertIn('--retry-all-errors', args)
            self.assertNotIn('--request', args); self.assertNotIn('--data', args)
            return '{"ok":true}' if args[-1].endswith('/api/health') else '<html>v13</html>'
        with patch.object(MOD, 'run', fetch):
            REAL_VERIFY_PUBLIC_WEB()
        self.assertEqual(len(calls), 3)


if __name__ == '__main__':
    unittest.main()
