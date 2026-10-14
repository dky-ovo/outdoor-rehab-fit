"""Local mocked Docker guard tests. No Docker daemon, SSH or RDS is contacted."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('ai_faq_installer', SOURCE / 'install.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
API = 'sha256:' + 'a' * 64
CADDY = 'sha256:' + 'c' * 64
NEW = 'sha256:' + 'b' * 64


class Host:
    def __init__(self, root):
        self.base = root / 'production'
        self.state = self.base / '.update-state/ai-faq-20261006-v15'
        self.release = self.base / 'releases' / MOD.PREFIX
        self.package = root / 'package'
        self.package.mkdir()
        self.web = self.base / 'releases/v14/web'
        self.web.mkdir(parents=True)
        (self.web / 'index.html').write_text('old website')
        (self.web / 'old.0123456789abcdef0123456789abcdef.js').write_text('old asset')
        (self.web / 'shared.png').write_bytes(b'shared image')
        self.caddyfile = self.base / 'Caddyfile'
        self.caddyfile.write_text('app.outdoorfit.hk { root * /srv/admin }')
        secrets = self.base / 'secrets'
        secrets.mkdir()
        (secrets / 'production.env').write_text('EXAMPLE=private$value\n')
        (secrets / 'mysql-password').write_text('private$value')
        current = self.base / '.update-state/current'
        current.mkdir(parents=True)
        (current / 'wait-mysql.sh').write_text('exec "$@"')
        self.config = {'name': MOD.PROJECT, 'services': {
            'api': {'image': API, 'environment': {'MYSQL_PASSWORD_FILE': '/run/secrets/mysql-password', 'EXAMPLE': 'private$value'},
                    'entrypoint': ['/bin/sh', '/outdoor-fit-ssh-migration/wait-mysql.sh'], 'command': ['node', 'src/production.js'],
                    'extra_hosts': {'private.rds.example': '172.18.0.1'},
                    'volumes': [{'type': 'bind', 'source': str(current), 'target': '/outdoor-fit-ssh-migration', 'read_only': True},
                                {'type': 'bind', 'source': str(secrets / 'mysql-password'), 'target': '/run/secrets/mysql-password', 'read_only': True}]},
            'caddy': {'image': CADDY, 'environment': {'ACME_EMAIL': 'synthetic@example.test'},
                      'volumes': [{'type': 'bind', 'source': str(self.web), 'target': '/srv/admin', 'read_only': True},
                                  {'type': 'bind', 'source': str(self.caddyfile), 'target': '/etc/caddy/Caddyfile', 'read_only': True}]}},
            'networks': {'default': {'name': MOD.PROJECT + '_default'}}}
        self.containers = {}
        for service in ('api', 'caddy'):
            config_path = current / (service + '.json')
            config_path.write_text(json.dumps(self.config))
            definition = self.config['services'][service]
            self.containers[service] = {'Id': ('a' if service == 'api' else 'c') * 64, 'Image': definition['image'],
                'State': {'Running': True}, 'Config': {'Image': definition['image'], 'Env': [key + '=' + value for key, value in definition['environment'].items()],
                    'Labels': {'com.docker.compose.project': MOD.PROJECT, 'com.docker.compose.service': service,
                               'com.docker.compose.project.config_files': str(config_path)},
                    'Cmd': definition.get('command'), 'Entrypoint': definition.get('entrypoint'), 'User': '1000:1000', 'WorkingDir': '/app'},
                'Mounts': [{'Type': item['type'], 'Source': item['source'], 'Destination': item['target'], 'RW': not item.get('read_only', False)} for item in definition['volumes']],
                'HostConfig': {'Memory': 1610612736, 'NanoCpus': 1500000000, 'PortBindings': {}, 'NetworkMode': MOD.PROJECT + '_default',
                               'ExtraHosts': ['private.rds.example:172.18.0.1'], 'RestartPolicy': {'Name': 'unless-stopped', 'MaximumRetryCount': 0}},
                'NetworkSettings': {'Networks': {MOD.PROJECT + '_default': {}}}}
        self.images = {API: API, CADDY: CADDY}
        self.events = []
        self.pending = 0
        self.stop_creates_pending = False
        self.health_fails_once = False
        self.counter = 1
        files = {}
        for name in MOD.SUPPORT:
            content = (SOURCE / name).read_bytes()
            (self.package / name).write_bytes(content)
            files[name] = MOD.digest(content)
        for name in MOD.BASELINE_SOURCE:
            target = self.package / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('export const updated = true;\n')
            files[name] = MOD.digest(target.read_bytes())
        (self.package / 'web').mkdir()
        for name, content in [('web/index.html', b'new website'), ('web/new.abcdef0123456789abcdef0123456789.js', b'new asset')]:
            (self.package / name).write_bytes(content)
            files[name] = MOD.digest(content)
        self.manifest = {'version': 1, 'release': MOD.PREFIX, 'files': files, 'baselineSourceFiles': MOD.BASELINE_SOURCE,
                         'baselineWebFiles': MOD.inventory(self.web, 'web/'),
                         'webFiles': {name: checksum for name, checksum in files.items() if name.startswith('web/')}}
        self.manifest['webFiles']['web/shared.png'] = MOD.digest(b'shared image')
        (self.package / 'manifest.json').write_text(json.dumps(self.manifest))

    def inspect(self, name):
        service = next(key for key, value in MOD.CONTAINERS.items() if value == name)
        return copy.deepcopy(self.containers[service])

    def source_hashes(self):
        return {name: self.manifest['files'][name] for name in MOD.BASELINE_SOURCE} if self.containers['api']['Image'] == NEW else MOD.BASELINE_SOURCE

    def run(self, args, timeout=180):
        self.events.append(args)
        if args[:3] == ['docker', 'image', 'ls']:
            return self.images.get(args[-1], '')
        if args[:2] == ['docker', 'tag']:
            self.images[args[-1]] = args[-2]
            return ''
        if args[:2] == ['docker', 'build']:
            assert '--network=none' in args and '--pull=false' in args
            self.images[MOD.IMAGE] = NEW
            self.images[NEW] = NEW
            return ''
        if args[:2] == ['docker', 'ps']:
            name = args[args.index('--filter') + 1]
            service = next(s for s in self.containers if MOD.CONTAINERS[s] in name)
            return self.containers[service]['Id']
        if args[:2] in (['docker', 'stop'], ['docker', 'start']):
            service = next(s for s in self.containers if MOD.CONTAINERS[s] == args[-1])
            self.containers[service]['State']['Running'] = args[1] == 'start'
            if args[1] == 'stop' and self.stop_creates_pending:
                self.pending = 1
            return ''
        if args[:2] == ['docker', 'compose']:
            config = json.loads(Path(args[args.index('-f') + 1]).read_text().replace('$$', '$'))
            if 'config' in args:
                return json.dumps(config)
            if 'up' in args:
                assert '--no-deps' in args and '--no-build' in args and args[args.index('--pull') + 1] == 'never'
                service = args[-1]
                definition = config['services'][service]
                current = self.containers[service]
                current['Image'] = self.images[definition['image']]
                current['Config']['Image'] = definition['image']
                current['Config']['Labels']['com.docker.compose.project.config_files'] = args[args.index('-f') + 1]
                current['Mounts'] = [{'Type': item['type'], 'Source': item['source'], 'Destination': item['target'], 'RW': not item.get('read_only', False)} for item in definition['volumes']]
                current['State']['Running'] = True
                self.counter += 1
                current['Id'] = hex(self.counter)[2:].zfill(64)
                return ''
        raise AssertionError('Unexpected mock command: ' + str(args[:3]))

    def idle(self):
        MOD.require(self.pending == 0, 'UPDATE_AI_BUSY_TRY_LATER')

    def health(self):
        if self.health_fails_once:
            self.health_fails_once = False
            raise RuntimeError('UPDATE_HEALTH_FAILED')


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.host = Host(Path(self.temp.name))
        for key, value in [('BASE', self.host.base), ('STATE', self.host.state), ('RELEASE', self.host.release), ('PACKAGE', self.host.package),
                           ('inspect', self.host.inspect), ('image_id', lambda ref: self.host.images[ref]), ('run', self.host.run),
                           ('source_hashes', self.host.source_hashes), ('no_pending_jobs', self.host.idle),
                           ('health', self.host.health), ('verify_https', lambda root: None)]:
            patcher = patch.object(MOD, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_check_only_is_read_only(self):
        MOD.prepare(check_only=True)
        self.assertFalse(self.host.state.exists())
        self.assertFalse(self.host.release.exists())
        self.assertFalse(any(args[:2] in (['docker', 'build'], ['docker', 'tag'], ['docker', 'stop']) for args in self.host.events))

    def test_prepare_preserves_tunnel_env_and_resources_and_merges_web_delta(self):
        MOD.prepare()
        new = json.loads((self.host.state / 'api.json').read_text().replace('$$', '$'))['services']['api']
        old = self.host.config['services']['api']
        self.assertEqual({k: v for k, v in new.items() if k != 'image'}, {k: v for k, v in old.items() if k != 'image'})
        self.assertEqual(new['image'], NEW)
        self.assertTrue((self.host.release / 'web/old.0123456789abcdef0123456789abcdef.js').is_file())
        self.assertEqual((self.host.release / 'web/shared.png').read_bytes(), b'shared image')
        self.assertEqual((self.host.release / 'web/index.html').read_text(), 'new website')
        self.assertTrue(all(c['State']['Running'] for c in self.host.containers.values()))

    def test_apply_uses_single_worker_and_rollback_restores_exact_images(self):
        MOD.prepare()
        MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'], NEW)
        stop_index = next(i for i, args in enumerate(self.host.events) if args[:2] == ['docker', 'stop'])
        up_index = next(i for i, args in enumerate(self.host.events) if args[:2] == ['docker', 'compose'] and 'up' in args)
        self.assertLess(stop_index, up_index)
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        MOD.rollback(recovery)
        self.assertEqual(self.host.containers['api']['Image'], API)
        self.assertEqual(self.host.containers['caddy']['Mounts'][0]['Source'], str(self.host.web))

    def test_busy_before_prepare_or_apply_never_stops_services(self):
        self.host.pending = 1
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_AI_BUSY'):
            MOD.prepare()
        self.assertFalse(self.host.state.exists())
        self.host.pending = 0
        MOD.prepare()
        self.host.pending = 1
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_AI_BUSY'):
            MOD.apply()
        self.assertFalse(any(args[:2] == ['docker', 'stop'] for args in self.host.events))

    def test_busy_during_drain_resumes_same_container_and_leaves_prepared_retryable(self):
        MOD.prepare()
        before = self.host.containers['caddy']['Id']
        self.host.stop_creates_pending = True
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_AI_BUSY'):
            MOD.apply()
        self.assertEqual(self.host.containers['caddy']['Id'], before)
        self.assertTrue(self.host.containers['caddy']['State']['Running'])
        self.assertEqual(json.loads((self.host.state / 'report.json').read_text())['status'], 'prepared')
        self.assertEqual(self.host.containers['api']['Image'], API)

    def test_health_failure_rolls_back_both_services(self):
        MOD.prepare()
        self.host.health_fails_once = True
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_HEALTH_FAILED'):
            MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'], API)
        self.assertTrue(all(c['State']['Running'] for c in self.host.containers.values()))
        self.assertEqual(json.loads((self.host.state / 'report.json').read_text())['status'], 'rolled_back')

    def test_manual_rollback_refuses_active_jobs_without_touching_current_api(self):
        MOD.prepare()
        MOD.apply()
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        self.host.pending = 1
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_AI_BUSY'):
            MOD.manual_rollback(recovery)
        self.assertEqual(self.host.containers['api']['Image'], NEW)
        self.assertTrue(self.host.containers['caddy']['State']['Running'])
        self.host.pending = 0
        MOD.manual_rollback(recovery)
        self.assertEqual(self.host.containers['api']['Image'], API)

    def test_changed_config_or_later_deployment_blocks_activation(self):
        MOD.prepare()
        path = self.host.state / 'api.json'
        original = path.read_bytes()
        path.write_bytes(original + b' ')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_RECOVERY_CONFIG_CHANGED'):
            MOD.apply()
        path.write_bytes(original)
        self.host.containers['api']['HostConfig']['ExtraHosts'] = ['different:172.18.0.2']
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_LATER_DEPLOYMENT_PRESENT'):
            MOD.apply()

    def test_package_tampering_and_incomplete_delta_are_rejected(self):
        index = self.host.package / 'web/index.html'
        original = index.read_bytes()
        index.write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_PACKAGE_HASH_MISMATCH'):
            MOD.prepare()
        index.write_bytes(original)
        self.host.manifest['webFiles']['web/missing.js'] = 'f' * 64
        (self.host.package / 'manifest.json').write_text(json.dumps(self.host.manifest))
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_WEB_DELTA_INCOMPLETE'):
            MOD.prepare()

    def test_public_api_port_and_source_mount_refused(self):
        self.host.containers['api']['HostConfig']['PortBindings'] = {'3000/tcp': [{'HostIp': '0.0.0.0', 'HostPort': '3000'}]}
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_API_PUBLIC_PORT_REQUIRES_REVIEW'):
            MOD.prepare()
        self.host.containers['api']['HostConfig']['PortBindings'] = {}
        self.host.containers['api']['Mounts'].append({'Type': 'bind', 'Source': str(self.host.base), 'Destination': '/app/src', 'RW': False})
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_MOUNT_SHADOWS_IMAGE'):
            MOD.prepare()


if __name__ == '__main__':
    unittest.main()
