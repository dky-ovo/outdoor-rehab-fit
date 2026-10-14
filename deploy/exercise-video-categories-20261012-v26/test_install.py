"""Local mocked Docker guard tests. No Docker daemon, SSH or RDS is contacted."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).parent
import sys
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location('exercise_video_categories_installer', SOURCE / 'install.py')
MOD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)
REAL_RUN = MOD.run
REAL_PENDING = MOD.no_pending_jobs
REAL_SOURCES = MOD.source_hashes
REAL_SCHEMA = MOD.schema_probe
BASE_A, BASE_B = tuple(MOD.BASELINE_SOURCES)[:2]
API = 'sha256:' + 'a' * 64
CADDY = 'sha256:' + 'c' * 64
NEW = 'sha256:' + 'b' * 64


class Host:
    def __init__(self, root):
        self.base = root / 'production'
        self.state = self.base / '.update-state/exercise-video-categories-20261012-v26'
        self.release = self.base / 'releases' / MOD.PREFIX
        self.package = root / 'package'
        self.package.mkdir()
        self.web = self.base / 'releases/v20/web'
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
        (secrets / 'dashscope-api-key').write_text('synthetic-test-key')
        current = self.base / '.update-state/current'
        current.mkdir(parents=True)
        (current / 'wait-mysql.sh').write_text('exec "$@"')
        self.config = {'name': MOD.PROJECT, 'services': {
            'api': {'image': API, 'environment': {'MYSQL_PASSWORD_FILE': '/run/secrets/mysql-password', 'EXAMPLE': 'private$value', 'ASSISTANT_PROVIDER_MODE': 'deepseek_only'},
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
        self.blueprints = copy.deepcopy(self.containers)
        self.images = {API: API, CADDY: CADDY}
        self.events = []
        self.pending = 0
        self.schema_ready = True
        self.schema_calls = []
        self.build_fails_once = False
        self.stop_creates_pending = False
        self.health_fails_once = False
        self.counter = 1
        self.baseline = BASE_A
        files = {}
        for name in MOD.SUPPORT:
            content = (SOURCE / name).read_bytes()
            (self.package / name).write_bytes(content)
            files[name] = MOD.digest(content)
        for name in MOD.UPDATE_SOURCE:
            target = self.package / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text('export const updated = true;\n')
            files[name] = MOD.digest(target.read_bytes())
        (self.package / 'web').mkdir()
        for name, content in [('web/index.html', b'new website'), ('web/new.abcdef0123456789abcdef0123456789.js', b'new asset')]:
            (self.package / name).write_bytes(content)
            files[name] = MOD.digest(content)
        baseline_web = MOD.inventory(self.web, 'web/')
        self.baseline_webs = {BASE_A: baseline_web, BASE_B: {**baseline_web, 'web/index.html': MOD.digest(b'variant-b website'), 'web/variant-b-retained.js': MOD.digest(b'variant-b asset')}}
        for key in MOD.BASELINE_SOURCES:
            self.baseline_webs.setdefault(key, {**baseline_web, 'web/index.html': MOD.digest(key.encode())})
        self.manifest = {'version': 2, 'release': MOD.PREFIX, 'files': files,
                         'baselines': {name: {'sourceFiles': source, 'webFiles': self.baseline_webs[name]} for name, source in MOD.BASELINE_SOURCES.items()},
                         'webFiles': {name: checksum for name, checksum in files.items() if name.startswith('web/')}}
        self.manifest['webFiles']['web/shared.png'] = MOD.digest(b'shared image')
        (self.package / 'manifest.json').write_text(json.dumps(self.manifest))

    def inspect(self, name):
        service = next(key for key, value in MOD.CONTAINERS.items() if value == name)
        return copy.deepcopy(self.containers[service])

    def source_hashes(self, image=None):
        return {name: self.manifest['files'][name] for name in MOD.UPDATE_SOURCE} if (image or self.containers['api']['Image']) == NEW else MOD.BASELINE_SOURCES[self.baseline]

    def use_other_web_variant(self):
        self.baseline = BASE_B
        (self.web / 'index.html').write_bytes(b'variant-b website')
        (self.web / 'variant-b-retained.js').write_bytes(b'variant-b asset')

    def run(self, args, timeout=180):
        self.events.append(args)
        if args[:3] == ['docker', 'image', 'ls']:
            return self.images.get(args[-1], '')
        if args[:2] == ['docker', 'tag']:
            self.images[args[-1]] = args[-2]
            return ''
        if args[:2] == ['docker', 'build']:
            if self.build_fails_once:
                self.build_fails_once = False
                raise MOD.CommandFailure('docker_build', 17)
            assert '--network=none' in args and '--pull=false' in args
            self.images[MOD.IMAGE] = NEW
            self.images[NEW] = NEW
            return ''
        if args[:2] == ['docker', 'ps']:
            name = args[args.index('--filter') + 1]
            service = next(s for s in self.containers if MOD.CONTAINERS[s] in name)
            return self.containers[service]['Id'] if self.containers[service] else ''
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
                current = self.containers[service] or copy.deepcopy(self.blueprints[service])
                self.containers[service] = current
                current['Image'] = self.images[definition['image']]
                current['Config']['Image'] = definition['image']
                current['Config']['Env'] = [key + '=' + str(value) for key, value in definition.get('environment', {}).items()]
                current['Config']['Labels']['com.docker.compose.project.config_files'] = args[args.index('-f') + 1]
                current['Mounts'] = [{'Type': item['type'], 'Source': item['source'], 'Destination': item['target'], 'RW': not item.get('read_only', False)} for item in definition['volumes']]
                current['State']['Running'] = '--no-start' not in args
                self.counter += 1
                current['Id'] = hex(self.counter)[2:].zfill(64)
                return ''
        raise AssertionError('Unexpected mock command: ' + str(args[:3]))

    def schema(self, password=None):
        self.schema_calls.append(password)
        if password is not None:
            self.schema_ready = True
        return {'status': 'ready' if self.schema_ready else 'missing',
                'missingColumns': [] if self.schema_ready else ['video_category', 'equipment_ids_json']}

    def idle(self):
        MOD.require(self.pending == 0, 'UPDATE_AI_BUSY_TRY_LATER')

    def health(self):
        if self.health_fails_once:
            self.health_fails_once = False
            raise RuntimeError('UPDATE_HEALTH_FAILED')


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SOURCE.parents[1] / "workspace-artifacts")
        self.addCleanup(self.temp.cleanup)
        self.host = Host(Path(self.temp.name))
        patcher = patch.object(MOD, 'BASELINE_WEB_DIGESTS', {name: MOD.web_digest(web) for name, web in self.host.baseline_webs.items()})
        patcher.start(); self.addCleanup(patcher.stop)
        for key, value in [('BASE', self.host.base), ('STATE', self.host.state), ('RELEASE', self.host.release), ('PACKAGE', self.host.package),
                           ('inspect', self.host.inspect), ('image_id', lambda ref: self.host.images[ref]), ('run', self.host.run),
                           ('source_hashes', self.host.source_hashes), ('no_pending_jobs', self.host.idle),
                           ('provider_smoke', lambda: None), ('schema_probe', self.host.schema),
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
        self.assertEqual({k: v for k, v in new.items() if k not in ('image', 'environment', 'volumes')}, {k: v for k, v in old.items() if k not in ('image', 'environment', 'volumes')})
        self.assertEqual(new['environment'], {**old['environment'], **MOD.DEEPSEEK_ENV})
        self.assertEqual(new['volumes'], old['volumes'])
        rollback_config = json.loads((self.host.state / 'rollback-api.json').read_text().replace('$$', '$'))
        self.assertEqual(rollback_config, self.host.config)
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

    def test_provider_smoke_failure_restores_exact_old_environment(self):
        MOD.prepare()
        original_env = self.host.containers['api']['Config']['Env'].copy()
        with patch.object(MOD, 'provider_smoke', side_effect=RuntimeError('UPDATE_PROVIDER_SMOKE_FAILED')):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_PROVIDER_SMOKE_FAILED'):
                MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'], API)
        self.assertEqual(self.host.containers['api']['Config']['Env'], original_env)
        self.assertTrue(all(c['State']['Running'] for c in self.host.containers.values()))

    def test_manual_rollback_refuses_active_jobs_without_touching_current_api(self):
        MOD.prepare()
        MOD.apply()
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        self.host.pending = 1
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_ROLLBACK_WAITING_FOR_AI'):
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


    def test_unknown_existing_deadline_or_changed_baseline_source_blocks_prepare(self):
        for name in ('server/src/assistantDeadline.js', 'server/src/accountContinuity.js'):
            changed = {**self.host.source_hashes(), name: '0' * 64}
            with patch.object(MOD, 'source_hashes', lambda: changed):
                with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_BASELINE_MISMATCH'):
                    MOD.prepare()
            self.assertFalse(self.host.state.exists())

    def test_candidate_missing_new_module_rolls_back(self):
        MOD.prepare()
        def source_hashes():
            result = self.host.source_hashes()
            if self.host.containers['api']['Image'] == NEW:
                result['server/src/assistantDeadline.js'] = None
            return result
        with patch.object(MOD, 'source_hashes', source_hashes):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_RUNNING_SOURCE_MISMATCH'):
                MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'], API)
        self.assertTrue(self.host.containers['caddy']['State']['Running'])

    def test_docker_context_includes_every_verified_replacement_and_new_module(self):
        ignored = (SOURCE / 'Dockerfile.dockerignore').read_text().splitlines()
        dockerfile = (SOURCE / 'Dockerfile').read_text()
        for name in MOD.UPDATE_SOURCE:
            self.assertIn('!' + name, ignored)
            self.assertIn(name, dockerfile)

    def test_existing_guide_helper_is_verified_on_v21_and_required_after_switch(self):
        self.assertEqual(self.host.source_hashes()['server/src/assistantGuideAnswers.js'], MOD.BASELINE_SOURCES[BASE_A]['server/src/assistantGuideAnswers.js'])
        self.assertIsInstance(self.host.source_hashes()['server/src/assistantGuideAnswers.js'], str)
        MOD.prepare()
        MOD.apply()
        self.assertEqual(self.host.source_hashes()['server/src/assistantGuideAnswers.js'],
                         self.host.manifest['files']['server/src/assistantGuideAnswers.js'])

    def test_other_web_variant_can_prepare_apply_and_rollback_without_losing_its_retained_asset(self):
        self.host.use_other_web_variant()
        MOD.prepare()
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        self.assertEqual(recovery['baselineName'], BASE_B)
        self.assertEqual(recovery['baselineSourceFiles'], MOD.BASELINE_SOURCES[BASE_B])
        self.assertTrue((self.host.release / 'web/variant-b-retained.js').is_file())
        MOD.apply(); MOD.manual_rollback(recovery)
        self.assertEqual(self.host.source_hashes(), MOD.BASELINE_SOURCES[BASE_B])
        self.assertEqual((self.host.web / 'index.html').read_bytes(), b'variant-b website')


    def test_unknown_added_policy_source_and_missing_baseline_deadline_both_fail_closed(self):
        self.host.use_other_web_variant()
        for name, value in [('server/src/assistantDeadline.js', None), ('server/src/assistantContentPolicy.js', '0' * 64)]:
            changed = {**self.host.source_hashes(), name: value}
            with patch.object(MOD, 'source_hashes', lambda: changed):
                with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_BASELINE_MISMATCH'):
                    MOD.prepare()
        self.assertFalse(self.host.state.exists())

    def test_missing_delta_cannot_rely_on_an_asset_present_in_only_one_baseline(self):
        self.host.manifest['webFiles']['web/variant-b-retained.js'] = MOD.digest(b'variant-b asset')
        (self.host.package / 'manifest.json').write_text(json.dumps(self.host.manifest))
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_WEB_DELTA_INCOMPLETE'):
            MOD.prepare()

    def test_recovery_cannot_switch_baseline_before_apply(self):
        MOD.prepare()
        path = self.host.state / 'recovery.json'
        recovery = json.loads(path.read_text()); recovery['baselineName'] = BASE_B; path.write_text(json.dumps(recovery))
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_RECOVERY_BASELINE_CHANGED'):
            MOD.apply()

    def test_https_failure_after_accepting_ai_preserves_worker_until_manual_rollback_is_idle(self):
        MOD.prepare()
        def https(root):
            if root == self.host.release / 'web':
                self.host.pending = 1
                raise RuntimeError('UPDATE_HTTPS_WEB_MISMATCH')
        with patch.object(MOD, 'verify_https', https):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_ROLLBACK_WAITING_FOR_AI'):
                MOD.apply()
            self.assertEqual(self.host.containers['api']['Image'], NEW)
            self.assertTrue(self.host.containers['caddy']['State']['Running'])
            self.assertEqual(json.loads((self.host.state / 'report.json').read_text())['status'], 'rollback_blocked')
            api_restarts = [args for args in self.host.events if args[:2] == ['docker', 'compose'] and 'up' in args and args[-1] == 'api']
            self.assertEqual(len(api_restarts), 1)
            self.host.pending = 0
            recovery = json.loads((self.host.state / 'recovery.json').read_text())
            MOD.manual_rollback(recovery)
            self.assertEqual(self.host.containers['api']['Image'], API)

    def test_https_failure_with_no_jobs_closes_ingress_again_before_rolling_back_api(self):
        MOD.prepare()
        def https(root):
            if root == self.host.release / 'web':
                raise RuntimeError('UPDATE_HTTPS_WEB_MISMATCH')
        with patch.object(MOD, 'verify_https', https):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_HTTPS_WEB_MISMATCH'):
                MOD.apply()
        stops = [i for i,args in enumerate(self.host.events) if args[:2] == ['docker', 'stop']]
        restarts = [i for i,args in enumerate(self.host.events) if args[:2] == ['docker', 'compose'] and 'up' in args and args[-1] == 'api']
        self.assertEqual(len(stops), 2)
        self.assertEqual(len(restarts), 2)
        self.assertLess(stops[1], restarts[1])
        self.assertEqual(self.host.containers['api']['Image'], API)



    def test_missing_bailian_key_does_not_block_any_phase(self):
        (self.host.base / 'secrets/dashscope-api-key').unlink()
        MOD.prepare(); MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'], NEW)

    def test_existing_bailian_env_and_mount_are_preserved_without_reading_key(self):
        for service in ('api',):
            definition = self.host.config['services'][service]
            definition['environment'].update({'DASHSCOPE_API_KEY_FILE': '/run/secrets/existing-key', 'BAILIAN_MODEL_ID': 'existing-model'})
            definition['volumes'].append({'type': 'bind', 'source': '/existing/secret/path', 'target': '/run/secrets/existing-key', 'read_only': True})
            container = self.host.containers[service]
            container['Config']['Env'] = [k+'='+v for k,v in definition['environment'].items()]
            container['Mounts'].append({'Type': 'bind', 'Source': '/existing/secret/path', 'Destination': '/run/secrets/existing-key', 'RW': False})
            for name in ('api','caddy'):
                Path(self.host.containers[name]['Config']['Labels']['com.docker.compose.project.config_files']).write_text(json.dumps(self.host.config))
        MOD.prepare(); MOD.apply()
        self.assertIn('BAILIAN_MODEL_ID=existing-model', self.host.containers['api']['Config']['Env'])
        self.assertIn('ASSISTANT_PROVIDER_MODE=deepseek_only', self.host.containers['api']['Config']['Env'])
        self.assertEqual(self.host.containers['api']['Mounts'][-1]['Source'], '/existing/secret/path')

    def test_build_failure_prepare_can_resume_without_mutating_live_containers(self):
        original = copy.deepcopy(self.host.containers)
        self.host.build_fails_once = True
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_COMMAND_FAILED_DOCKER_BUILD'):
            MOD.prepare()
        self.assertEqual(self.host.containers, original)
        MOD.prepare(); MOD.prepare(); MOD.apply(); MOD.apply()
        ups = [a for a in self.host.events if a[:2] == ['docker','compose'] and 'up' in a and a[-1]=='api']
        self.assertEqual(len(ups), 1)

    def test_resume_prepare_refuses_different_live_container_or_partial_tamper(self):
        self.host.build_fails_once = True
        with self.assertRaises(RuntimeError): MOD.prepare()
        source = self.host.release / 'package/README.md'
        source.write_text('unexpected')
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_STAGING_CONTENT_CHANGED'): MOD.prepare()
        source.write_bytes((self.host.package / 'README.md').read_bytes())
        self.host.containers['api']['Id'] = 'f'*64
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_PREPARE_HOST_CHANGED'): MOD.prepare()

    def test_stopped_initial_services_are_accepted_and_rollback_restores_stopped(self):
        for container in self.host.containers.values(): container['State']['Running'] = False
        MOD.prepare(); MOD.apply()
        self.assertTrue(all(c['State']['Running'] for c in self.host.containers.values()))
        recovery = json.loads((self.host.state / 'recovery.json').read_text())
        MOD.manual_rollback(recovery)
        self.assertFalse(any(c['State']['Running'] for c in self.host.containers.values()))
        self.assertTrue(any('--no-start' in a for a in self.host.events))
        MOD.apply()
        self.assertTrue(all(c['State']['Running'] for c in self.host.containers.values()))

    def test_partial_apply_with_candidate_api_and_old_web_resumes_without_worker_restart(self):
        MOD.prepare(); MOD.up('api')
        self.host.pending = 1
        before = self.host.containers['api']['Id']
        MOD.save('report.json', {'status':'activating','release':MOD.PREFIX})
        MOD.apply()
        self.assertEqual(self.host.containers['api']['Id'], before)
        self.assertEqual(json.loads((self.host.state/'report.json').read_text())['status'], 'complete')

    def test_rollback_command_failure_is_retryable_and_preserves_failure_metadata(self):
        MOD.prepare()
        real = self.host.run
        blocked = {'yes':True}
        def failing(args, timeout=180):
            if 'rollback-api.json' in ' '.join(args) and 'up' in args and blocked['yes']:
                blocked['yes'] = False
                raise MOD.CommandFailure('compose_up', 19)
            return real(args,timeout)
        self.host.health_fails_once = True
        with patch.object(MOD,'run', failing):
            with self.assertRaisesRegex(RuntimeError,'UPDATE_COMMAND_FAILED_COMPOSE_UP'): MOD.apply()
        report = json.loads((self.host.state/'report.json').read_text())
        self.assertEqual(report['status'],'rollback_failed')
        self.assertEqual(report['rollbackError']['exitCode'],19)
        self.assertEqual(report['activationError']['code'],'UPDATE_HEALTH_FAILED')
        MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'],NEW)

    def test_stopped_source_probe_is_networkless_and_does_not_start_worker(self):
        self.host.containers['api']['State']['Running'] = False
        with patch.object(MOD,'run', return_value=json.dumps(MOD.BASELINE_SOURCES[BASE_A])) as called:
            self.assertEqual(REAL_SOURCES(), MOD.BASELINE_SOURCES[BASE_A])
        args = called.call_args.args[0]
        self.assertEqual(args[:3], ['docker','run','--rm'])
        self.assertIn('none', args); self.assertIn('--read-only', args)
        self.assertEqual(args[args.index('--entrypoint')+1], 'node')

    def test_stopped_queue_probe_is_one_shot_with_original_compose_and_no_worker(self):
        self.host.containers['api']['State']['Running'] = False
        def command(args,timeout=180):
            if args[:2] == ['docker','ps'] or 'config' in args: return self.host.run(args,timeout)
            self.assertIn('run',args); self.assertIn('--no-deps',args)
            self.assertNotIn('--build',args); self.assertNotIn('--no-build',args); self.assertIn('--entrypoint',args)
            self.assertEqual(args[args.index('--entrypoint')+1], 'node')
            self.assertNotIn('src/production.js',args)
            return '{"pending":0}'
        with patch.object(MOD,'run', command): REAL_PENDING()

    def test_command_error_details_do_not_echo_credentials_or_raw_stderr(self):
        import subprocess
        with patch.object(MOD.subprocess,'run', return_value=subprocess.CompletedProcess(['secret'],17,'password=secret','api_key=secret')):
            with self.assertRaises(MOD.CommandFailure) as raised: REAL_RUN(['docker','build','secret'])
        details = MOD.error_details(raised.exception)
        self.assertEqual(details['exitCode'],17)
        self.assertEqual(details['tool'],'docker_build')
        self.assertNotIn('secret',json.dumps(details))



    def test_v25_web_with_v23_api_can_apply_and_restore_exact_predecessor(self):
        chosen = next(name for name in MOD.BASELINE_SOURCES if name.startswith('v25-from-v24-from-v23-from-v21-v16'))
        self.host.baseline = chosen
        (self.host.web/'index.html').write_bytes(chosen.encode())
        MOD.prepare(); MOD.apply()
        recovery = json.loads((self.host.state/'recovery.json').read_text())
        self.assertEqual(recovery['baselineName'],chosen)
        MOD.manual_rollback(recovery)
        self.assertEqual((self.host.web/'index.html').read_bytes(),chosen.encode())

    def test_missing_api_after_known_recreate_failure_can_resume(self):
        MOD.prepare()
        self.host.containers['api'] = None
        MOD.save('report.json', {'status':'activating', 'release':MOD.PREFIX})
        MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'],NEW)
        self.assertTrue(self.host.containers['api']['State']['Running'])

    def test_rollback_never_stops_manually_started_old_worker_with_pending_jobs(self):
        self.host.containers['api']['State']['Running'] = False
        MOD.prepare()
        recovery=json.loads((self.host.state/'recovery.json').read_text())
        self.host.containers['api']['State']['Running']=True
        self.host.pending=1
        with self.assertRaisesRegex(RuntimeError,'UPDATE_ROLLBACK_WAITING_FOR_AI'):
            MOD.manual_rollback(recovery)
        self.assertTrue(self.host.containers['api']['State']['Running'])
        self.assertTrue(self.host.containers['caddy']['State']['Running'])

    def test_real_sealed_v23_api_and_v23_v24_v25_web_match_installer_constants(self):
        package_path=SOURCE.parents[1]/'scripts/package-exercise-video-categories-v26.py'
        spec=importlib.util.spec_from_file_location('v26_package',package_path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        known=module.baselines()
        self.assertEqual(set(known),set(MOD.BASELINE_SOURCES))
        self.assertEqual(len(known),24)
        # Load unpatched production constants for the sealed-data comparison.
        fresh_spec=importlib.util.spec_from_file_location('v26_fresh_installer',SOURCE/'install.py')
        fresh=importlib.util.module_from_spec(fresh_spec);fresh_spec.loader.exec_module(fresh)
        web_hashes=fresh.BASELINE_WEB_DIGESTS
        for name,row in known.items():
            self.assertEqual(row['sourceFiles'],MOD.BASELINE_SOURCES[name])
            self.assertEqual(MOD.web_digest(row['webFiles']),web_hashes[name])



    def test_bad_candidate_is_rejected_before_any_production_container_restart(self):
        original = copy.deepcopy(self.host.containers)
        def hashes(image=None):
            value = self.host.source_hashes(image).copy()
            if image: value['server/src/assistantProviders.js'] = 'f'*64
            return value
        with patch.object(MOD,'source_hashes',hashes):
            with self.assertRaisesRegex(RuntimeError,'UPDATE_CANDIDATE_SOURCE_MISMATCH'): MOD.prepare()
        self.assertEqual(self.host.containers,original)
        self.assertFalse((self.host.state/'recovery.json').exists())
        MOD.prepare(); MOD.apply()



    def test_prepare_recovers_crash_between_recovery_and_prepared_marker(self):
        actual_save=MOD.save
        def interrupted(name,value):
            if name=='report.json' and value.get('status')=='prepared': raise KeyboardInterrupt()
            return actual_save(name,value)
        with patch.object(MOD,'save',interrupted):
            with self.assertRaises(KeyboardInterrupt): MOD.prepare()
        self.assertTrue((self.host.state/'recovery.json').is_file())
        MOD.prepare(); MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'],NEW)


    def test_missing_schema_blocks_apply_before_stopping_any_service(self):
        self.host.schema_ready = False
        MOD.prepare()
        before = copy.deepcopy(self.host.containers)
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_SCHEMA_MIGRATION_REQUIRED'):
            MOD.apply()
        self.assertEqual(self.host.containers, before)
        self.assertFalse(any(args[:2] == ['docker', 'stop'] for args in self.host.events))
        self.assertTrue(all(value is None for value in self.host.schema_calls))

    def test_interactive_migration_is_separate_idempotent_and_keeps_original_services(self):
        self.host.schema_ready = False
        MOD.prepare()
        before = copy.deepcopy(self.host.containers)
        with patch.object(MOD.getpass, 'getpass', return_value='synthetic-secret') as prompt:
            MOD.migrate()
            MOD.migrate()
            self.assertEqual(prompt.call_count, 1)
        self.assertEqual(self.host.containers, before)
        self.assertEqual(self.host.schema_calls.count('synthetic-secret'), 1)
        self.assertIsNone(self.host.schema_calls[-1])
        self.assertNotIn('synthetic-secret', (self.host.state / 'schema-report.json').read_text())
        self.assertEqual(json.loads((self.host.state / 'report.json').read_text())['status'], 'prepared')
        MOD.apply()
        MOD.manual_rollback(json.loads((self.host.state / 'recovery.json').read_text()))
        self.assertTrue(self.host.schema_ready)
        self.assertEqual(self.host.containers['api']['Image'], API)

    def test_migration_failure_leaves_services_running_and_can_retry(self):
        self.host.schema_ready = False
        MOD.prepare()
        before = copy.deepcopy(self.host.containers)
        real = self.host.schema
        def probe(password=None):
            if password is not None:
                raise RuntimeError('UPDATE_SCHEMA_CONFLICT')
            return real(password)
        with patch.object(MOD, 'schema_probe', probe), patch.object(MOD.getpass, 'getpass', return_value='secret'):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_SCHEMA_CONFLICT'): MOD.migrate()
        self.assertEqual(self.host.containers, before)
        with patch.object(MOD.getpass, 'getpass', return_value='retry-secret'): MOD.migrate()
        MOD.apply()
        self.assertEqual(self.host.containers['api']['Image'], NEW)

    def test_schema_probe_is_candidate_one_shot_and_password_only_in_stdin(self):
        MOD.prepare()
        with patch.object(MOD, 'run', return_value='{"status":"ready","missingColumns":[]}') as called:
            self.assertEqual(REAL_SCHEMA('not-in-argv')['status'], 'ready')
        args = called.call_args.args[0]
        self.assertIn('run', args); self.assertIn('--no-deps', args); self.assertIn('-T', args)
        self.assertEqual(args[args.index('--entrypoint') + 1], 'node')
        self.assertEqual(args[-2:], ['scripts/migrate-exercise-video-metadata.js', '--apply'])
        self.assertNotIn('not-in-argv', ' '.join(args))
        self.assertEqual(json.loads(called.call_args.kwargs['data']), {'password': 'not-in-argv'})
        with patch.object(MOD, 'run', return_value='{"status":"missing","missingColumns":["video_category"]}') as called:
            self.assertEqual(REAL_SCHEMA()['status'], 'missing')
            self.assertIsNone(called.call_args.kwargs['data'])
            self.assertEqual(called.call_args.args[0][-1], '--check-only')

    def test_schema_probe_rejects_invalid_or_ambiguous_success(self):
        MOD.prepare()
        for data in [{'status':'ready','missingColumns':['video_category']},
                     {'status':'missing','missingColumns':[]},
                     {'status':'missing','missingColumns':['other_table']},
                     {'status':'missing','missingColumns':['video_category','video_category']},
                     {'status':'ready','missingColumns':[],'password':'unexpected'}]:
            with patch.object(MOD, 'run', return_value=json.dumps(data)):
                with self.assertRaisesRegex(RuntimeError, 'UPDATE_SCHEMA_RESPONSE_INVALID'): REAL_SCHEMA()

    def test_v26_never_changes_an_existing_provider_mode_to_make_a_baseline_pass(self):
        service = self.host.config['services']['api']
        service['environment']['ASSISTANT_PROVIDER_MODE'] = 'dual'
        self.host.containers['api']['Config']['Env'] = [k+'='+v for k,v in service['environment'].items()]
        for name in ('api','caddy'):
            Path(self.host.containers[name]['Config']['Labels']['com.docker.compose.project.config_files']).write_text(json.dumps(self.host.config))
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_DEEPSEEK_MODE_BASELINE_REQUIRED'): MOD.prepare()
        self.assertFalse(self.host.state.exists())

    def test_migration_cli_shadow_mount_is_rejected(self):
        self.host.containers['api']['Mounts'].append({'Type':'bind','Source':str(self.host.base),'Destination':'/app/scripts','RW':False})
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_MOUNT_SHADOWS_IMAGE'): MOD.prepare()

    def test_migration_error_only_reports_whitelisted_code_not_secret_sql(self):
        import subprocess
        MOD.phase('schema_apply')
        result = subprocess.CompletedProcess([], 1, '', 'password=secret SQL=private\nERROR_CODE=EXERCISE_VIDEO_SCHEMA_CONFLICT\n')
        with patch.object(MOD.subprocess, 'run', return_value=result) as called:
            with self.assertRaises(MOD.CommandFailure) as error:
                REAL_RUN(['docker','compose','run'], data='{"password":"secret"}')
            self.assertEqual(called.call_args.kwargs['input'], '{"password":"secret"}')
        details = MOD.error_details(error.exception)
        self.assertEqual(details['databaseCode'], 'EXERCISE_VIDEO_SCHEMA_CONFLICT')
        self.assertNotIn('secret', json.dumps(details)); self.assertNotIn('SQL', json.dumps(details))

    def test_recovery_cannot_reseal_an_unpublished_target_web_tree(self):
        MOD.prepare()
        recovery_path = self.host.state / 'recovery.json'
        recovery = json.loads(recovery_path.read_text())
        (self.host.release / 'web/index.html').write_bytes(b'unpublished content')
        recovery['targetWebFiles']['web/index.html'] = MOD.digest(b'unpublished content')
        recovery_path.write_text(json.dumps(recovery))
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_RECOVERY_TARGET_CHANGED'):
            MOD.apply()
        self.assertFalse(any(args[:2] == ['docker', 'stop'] for args in self.host.events))


if __name__ == '__main__':
    unittest.main()

