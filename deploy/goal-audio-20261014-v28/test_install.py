"""Pure local Docker model; no live API, Docker daemon, credentials or RDS."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
sys.dont_write_bytecode = True
SOURCE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('frontend_loading_installer', SOURCE / 'install.py')
MOD = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(MOD)
BASE_A, BASE_B = tuple(MOD.BASELINE_WEB_DIGESTS)[:2]
API='sha256:'+'a'*64
CADDY='sha256:'+'c'*64
NEW='sha256:'+'b'*64
class Host:
    def __init__(self, root):
        self.base = root / 'production'
        self.state = self.base / '.update-state/goal-audio-20261014-v28'
        self.release = self.base / 'releases' / MOD.PREFIX
        self.package = root / 'package'
        self.package.mkdir()
        self.web = self.base / 'releases/v26/web'
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
        self.build_fails_once = False
        self.stop_creates_pending = False
        self.health_fails_once = False
        self.counter = 1
        self.api_sources = MOD.REQUIRED_API_SOURCE.copy()
        self.baseline = BASE_A
        files = {}
        for name in MOD.SUPPORT:
            content = (SOURCE / name).read_bytes()
            (self.package / name).write_bytes(content)
            files[name] = MOD.digest(content)
        (self.package / 'web').mkdir()
        for name, content in [('web/index.html', b'new website'), ('web/new.abcdef0123456789abcdef0123456789.js', b'new asset')]:
            (self.package / name).write_bytes(content)
            files[name] = MOD.digest(content)
        baseline_web = MOD.inventory(self.web, 'web/')
        self.baseline_webs = {BASE_A: baseline_web, BASE_B: {**baseline_web, 'web/index.html': MOD.digest(b'variant-b website'), 'web/variant-b-retained.js': MOD.digest(b'variant-b asset')}}
        for key in MOD.BASELINE_WEB_DIGESTS:
            self.baseline_webs.setdefault(key, {**baseline_web, 'web/index.html': MOD.digest(key.encode())})
        self.manifest = {'version': 1, 'requiredApiSourceFiles': MOD.REQUIRED_API_SOURCE, 'release': MOD.PREFIX, 'files': files,
                         'baselines': {name: {'webFiles': self.baseline_webs[name]} for name, source in MOD.BASELINE_WEB_DIGESTS.items()},
                         'webFiles': {name: checksum for name, checksum in files.items() if name.startswith('web/')}}
        self.manifest['webFiles']['web/shared.png'] = MOD.digest(b'shared image')
        (self.package / 'manifest.json').write_text(json.dumps(self.manifest))

    def inspect(self, name):
        service = next(key for key, value in MOD.CONTAINERS.items() if value == name)
        return copy.deepcopy(self.containers[service])

    def use_other_web_variant(self):
        self.baseline = BASE_B
        (self.web / 'index.html').write_bytes(b'variant-b website')
        (self.web / 'variant-b-retained.js').write_bytes(b'variant-b asset')

    def run(self, args, timeout=180):
        self.events.append(args)
        if args[:2] == ['docker', 'exec']:
            assert args[2] == MOD.CONTAINERS['api'] and args[3:5] == ['node', '-e']
            return json.dumps(self.api_sources)
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

    def idle(self):
        MOD.require(self.pending == 0, 'UPDATE_AI_BUSY_TRY_LATER')

    def health(self):
        if self.health_fails_once:
            self.health_fails_once = False
            raise RuntimeError('UPDATE_HEALTH_FAILED')

class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=SOURCE.parents[1]/'workspace-artifacts')
        self.addCleanup(self.temp.cleanup)
        self.host=Host(Path(self.temp.name))
        self.original_api=copy.deepcopy(self.host.containers['api'])
        for key,value in [('BASE',self.host.base),('STATE',self.host.state),('RELEASE',self.host.release),('PACKAGE',self.host.package),
                          ('BASELINE_WEB_DIGESTS',{n:MOD.web_digest(w) for n,w in self.host.baseline_webs.items()}),
                          ('inspect',self.host.inspect),('image_id',lambda name:self.host.images[name]),('run',self.host.run),('verify_https',lambda root:None)]:
            p=patch.object(MOD,key,value);p.start();self.addCleanup(p.stop)

    def assert_api_untouched(self):
        self.assertEqual(self.host.containers['api'],self.original_api)
        for cmd in self.host.events:
            self.assertNotIn(cmd[:2], (['docker','stop'],['docker','start'],['docker','build'],['docker','tag']))
            if cmd[:2]==['docker','compose'] and 'up' in cmd:
                self.assertEqual(cmd[-1],'caddy');self.assertIn('--no-deps',cmd)

    def test_check_only_is_read_only(self):
        MOD.prepare(check_only=True)
        self.assertFalse(self.host.state.exists());self.assertFalse(self.host.release.exists())
        self.assert_api_untouched()

    def test_prepare_changes_only_caddy_web_volume(self):
        MOD.prepare()
        old=self.host.config
        new=json.loads((self.host.state/'caddy.json').read_text().replace('$$','$'))
        expected=copy.deepcopy(old)
        expected['services']['caddy']['volumes'][0]['source']=str(self.host.release/'web')
        self.assertEqual(new,expected)
        self.assertEqual(json.loads((self.host.state/'rollback-caddy.json').read_text().replace('$$','$')),old)
        self.assertEqual((self.host.release/'web/shared.png').read_bytes(),b'shared image')
        self.assert_api_untouched()

    def test_apply_retry_rollback_and_reapply_only_recreate_caddy(self):
        MOD.prepare();MOD.prepare();MOD.apply()
        after=self.host.containers['caddy']['Id'];MOD.apply()
        self.assertEqual(self.host.containers['caddy']['Id'],after)
        recovery=json.loads((self.host.state/'recovery.json').read_text())
        MOD.rollback(recovery);MOD.rollback(recovery)
        self.assertEqual(self.host.containers['caddy']['Mounts'][0]['Source'],str(self.host.web))
        MOD.apply();self.assert_api_untouched()

    def test_old_api_or_missing_gate_requires_v26_before_any_write(self):
        self.host.api_sources['server/src/app.js']='0'*64
        with self.assertRaisesRegex(RuntimeError,'UPDATE_INSTALL_V26_FIRST'):MOD.prepare()
        self.assertFalse(self.host.state.exists())
        self.host.api_sources=MOD.REQUIRED_API_SOURCE.copy()
        self.host.containers['api']['Config']['Env'].remove('ASSISTANT_PROVIDER_MODE=deepseek_only')
        with self.assertRaisesRegex(RuntimeError,'UPDATE_INSTALL_V26_FIRST'):MOD.prepare()

    def test_stopped_api_is_not_started(self):
        self.host.containers['api']['State']['Running']=False
        with self.assertRaisesRegex(RuntimeError,'UPDATE_V26_API_MUST_BE_RUNNING'):MOD.prepare()
        self.assertFalse(self.host.state.exists())
        self.assertFalse(any(c[:2]==['docker','start'] for c in self.host.events))

    def test_old_unknown_web_requires_v26(self):
        (self.host.web/'index.html').write_text('not sealed')
        with self.assertRaisesRegex(RuntimeError,'UPDATE_WEB_BASELINE_REQUIRED'):MOD.prepare()
        self.assertFalse(self.host.state.exists());self.assert_api_untouched()

    def test_other_web_baseline_retains_its_assets(self):
        self.host.use_other_web_variant();MOD.prepare();MOD.apply()
        self.assertTrue((self.host.release/'web/variant-b-retained.js').is_file())
        MOD.rollback(json.loads((self.host.state/'recovery.json').read_text()));self.assert_api_untouched()

    def test_changed_api_container_start_or_configuration_blocks_apply(self):
        MOD.prepare()
        for field in ('Id','StartedAt','Environment'):
            self.host.containers['api']=copy.deepcopy(self.original_api)
            if field=='Id':self.host.containers['api']['Id']='f'*64
            elif field=='StartedAt':self.host.containers['api']['State']['StartedAt']='changed'
            else:self.host.containers['api']['Config']['Env'].append('NEW=value')
            with self.assertRaisesRegex(RuntimeError,'UPDATE_API_CHANGED_NOT_TOUCHED'):MOD.apply()
        self.assertFalse(any('up' in c for c in self.host.events))

    def test_https_failure_rolls_back_only_web(self):
        MOD.prepare()
        def https(root):
            if root==self.host.release/'web':raise RuntimeError('UPDATE_HTTPS_WEB_MISMATCH')
        with patch.object(MOD,'verify_https',https):
            with self.assertRaisesRegex(RuntimeError,'UPDATE_HTTPS_WEB_MISMATCH'):MOD.apply()
        self.assertEqual(self.host.containers['caddy']['Mounts'][0]['Source'],str(self.host.web))
        self.assert_api_untouched();MOD.apply()

    def test_missing_caddy_after_known_recreate_failure_can_resume(self):
        MOD.prepare();self.host.containers['caddy']=None
        MOD.save('report.json',{'status':'activating','release':MOD.PREFIX})
        MOD.apply();self.assert_api_untouched()

    def test_failed_rollback_is_retryable_without_touching_api(self):
        MOD.prepare();real=self.host.run;failed={'yes':False}
        def command(args,timeout=180):
            if 'up' in args and 'rollback-caddy.json' in ' '.join(args) and not failed['yes']:
                failed['yes']=True;raise MOD.CommandFailure('compose_up',18)
            return real(args,timeout)
        def https(root):
            if root==self.host.release/'web':raise RuntimeError('UPDATE_HTTPS_WEB_MISMATCH')
        with patch.object(MOD,'run',command),patch.object(MOD,'verify_https',https):
            with self.assertRaisesRegex(RuntimeError,'UPDATE_COMMAND_FAILED_COMPOSE_UP'):MOD.apply()
        self.assertEqual(json.loads((self.host.state/'report.json').read_text())['status'],'rollback_failed')
        MOD.apply();self.assert_api_untouched()

    def test_changed_caddy_or_saved_config_is_not_overwritten(self):
        MOD.prepare();file=self.host.state/'caddy.json';data=file.read_bytes();file.write_bytes(data+b' ')
        with self.assertRaisesRegex(RuntimeError,'UPDATE_RECOVERY_CONFIG_CHANGED'):MOD.apply()
        file.write_bytes(data);self.host.containers['caddy']['HostConfig']['ExtraHosts']=['unknown:127.0.0.2']
        with self.assertRaisesRegex(RuntimeError,'UPDATE_LATER_DEPLOYMENT_PRESENT'):MOD.apply()
        self.assert_api_untouched()

    def test_staging_and_recovery_marker_interruptions_resume(self):
        real=MOD.copy_atomic;once={'yes':True}
        def interrupt(source,target):
            if once['yes']:once['yes']=False;raise KeyboardInterrupt()
            return real(source,target)
        with patch.object(MOD,'copy_atomic',interrupt):
            with self.assertRaises(KeyboardInterrupt):MOD.prepare()
        actual=MOD.save
        def save(name,row):
            if name=='report.json' and row.get('status')=='prepared':raise KeyboardInterrupt()
            return actual(name,row)
        with patch.object(MOD,'save',save):
            with self.assertRaises(KeyboardInterrupt):MOD.prepare()
        MOD.prepare();MOD.apply();self.assert_api_untouched()

    def test_server_payload_and_modified_source_manifest_are_rejected(self):
        self.host.manifest['files']['server/src/app.js']='0'*64
        (self.host.package/'manifest.json').write_text(json.dumps(self.host.manifest))
        with self.assertRaisesRegex(RuntimeError,'UPDATE_WEB_ONLY_PAYLOAD_REQUIRED'):MOD.prepare()
        del self.host.manifest['files']['server/src/app.js']
        self.host.manifest['requiredApiSourceFiles']={**MOD.REQUIRED_API_SOURCE,'server/src/app.js':'0'*64}
        (self.host.package/'manifest.json').write_text(json.dumps(self.host.manifest))
        with self.assertRaisesRegex(RuntimeError,'UPDATE_API_BASELINE_INVALID'):MOD.prepare()

    def test_changed_staged_web_cannot_be_approved_by_editing_recovery_hash(self):
        MOD.prepare()
        path=self.host.state/'recovery.json'
        recovery=json.loads(path.read_text())
        (self.host.release/'web/index.html').write_bytes(b'unknown website')
        recovery['targetWebFiles']['web/index.html']=MOD.digest(b'unknown website')
        path.write_text(json.dumps(recovery))
        with self.assertRaisesRegex(RuntimeError,'UPDATE_RECOVERY_TARGET_CHANGED'):MOD.apply()
        self.assert_api_untouched()

    def test_sealed_v26_api_and_twelve_v26_v24_web_trees_match_constants(self):
        spec=importlib.util.spec_from_file_location('v25_packager',SOURCE.parents[1]/'scripts/package-goal-audio-v28.py')
        package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)
        api,web=package.baselines();self.assertEqual(api,MOD.REQUIRED_API_SOURCE);self.assertEqual(len(web),24)
        spec=importlib.util.spec_from_file_location('v25_fresh',SOURCE/'install.py')
        fresh=importlib.util.module_from_spec(spec);spec.loader.exec_module(fresh)
        self.assertEqual({n:MOD.web_digest(w) for n,w in web.items()},fresh.BASELINE_WEB_DIGESTS)


    def test_known_v24_web_can_update_and_restore_without_restarting_api(self):
        chosen=next(name for name in MOD.BASELINE_WEB_DIGESTS if name.startswith('v26-from-v25-'))
        self.host.baseline=chosen
        (self.host.web/'index.html').write_bytes(chosen.encode())
        MOD.prepare();MOD.apply()
        recovery=json.loads((self.host.state/'recovery.json').read_text())
        self.assertEqual(recovery['baselineName'],chosen)
        self.assertTrue((self.host.release/'web/old.0123456789abcdef0123456789abcdef.js').is_file())
        MOD.rollback(recovery)
        self.assertEqual(self.host.containers['caddy']['Mounts'][0]['Source'],str(self.host.web))
        self.assert_api_untouched()

if __name__=='__main__':unittest.main()
