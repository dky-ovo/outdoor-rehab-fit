"""Pure-memory deployment regression tests; no Docker, network or file writes."""
import ast
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load('v12_installer', 'deploy/app-suggestions-20261002-v12/install.py')
packager = load('v12_packager', 'scripts/package-app-suggestions-v12.py')


class ComposePreservation(unittest.TestCase):
    def test_literal_values_survive_without_mutating_input(self):
        value = {'services': {'api': {'environment': {'PROXY': 'https://user:pa${UNSET}$suffix@proxy.invalid'},
                                      'command': ['sh', '-c', 'echo $HOME'], 'replicas': 1}}}
        before = copy.deepcopy(value)
        escaped = installer.literal_compose(value)
        self.assertEqual(escaped['services']['api']['environment']['PROXY'], 'https://user:pa$${UNSET}$$suffix@proxy.invalid')
        self.assertEqual(escaped['services']['api']['command'][-1], 'echo $$HOME')
        self.assertEqual(value, before)

    def test_roundtrip_checks_entire_resolved_configuration(self):
        config = {'services': {'api': {'environment': {'TEST_VALUE': 'a$b'}}}, 'networks': {'default': {'name': 'production'}}}
        with patch.object(installer, 'save', return_value=Path('/fake/config.json')) as save, \
                patch.object(installer, 'run', return_value=json.dumps(config)):
            installer.save_compose('config.json', config)
        self.assertEqual(save.call_args.args[1]['services']['api']['environment']['TEST_VALUE'], 'a$$b')
        damaged = copy.deepcopy(config)
        damaged['services']['api']['environment']['TEST_VALUE'] = 'a'
        with patch.object(installer, 'save', return_value=Path('/fake/config.json')), \
                patch.object(installer, 'run', return_value=json.dumps(damaged)):
            with self.assertRaisesRegex(RuntimeError, 'ROUNDTRIP_MISMATCH'):
                installer.save_compose('config.json', config)


class TemporaryFeatureSafety(unittest.TestCase):
    def test_default_is_off_explicit_enable_changes_only_feature_flag(self):
        value = {'services': {'api': {'environment': {'PROXY': 'https://user:pa${UNSET}$suffix@proxy.invalid', 'TEMP_TEST_USERS_ENABLED': 'true'}, 'image': 'baseline'}}}
        before = copy.deepcopy(value)
        disabled = installer.configure_test_users(value)
        self.assertEqual(disabled['services']['api']['environment']['TEMP_TEST_USERS_ENABLED'], 'false')
        enabled = installer.configure_test_users(value, True)
        self.assertEqual(enabled['services']['api']['environment']['TEMP_TEST_USERS_ENABLED'], 'true')
        self.assertEqual(disabled['services']['api']['environment']['PROXY'], value['services']['api']['environment']['PROXY'])
        self.assertEqual(value, before)

    def test_disable_refuses_later_deployment_before_configuration_writes(self):
        state = MagicMock()
        state.is_dir.return_value = True
        state.is_symlink.return_value = False
        state.__truediv__.return_value.read_text.return_value = '{}'
        with patch.object(installer, 'STATE', state), patch.object(installer, 'observe_recovery', return_value={}), patch.object(installer, 'recovery_guard', side_effect=RuntimeError('UPDATE_LATER_DEPLOYMENT_PRESENT')), patch.object(installer, 'save_compose') as save, patch.object(installer, 'up') as up:
            with self.assertRaisesRegex(RuntimeError, 'LATER_DEPLOYMENT_PRESENT'):
                installer.disable_test_users()
        save.assert_not_called()
        up.assert_not_called()


class RecoverySafety(unittest.TestCase):
    def fixture(self):
        recovery, observed = {}, {}
        for service in ('api', 'caddy'):
            config = '/private/' + service + '.json'
            image = 'sha256:' + service
            recovery[service] = {'configFiles': [config], 'imageIds': [image]}
            observed[service] = {'Image': image, 'Config': {'Labels': {
                'com.docker.compose.project': installer.PROJECT,
                'com.docker.compose.service': service,
                'com.docker.compose.project.config_files': config}}}
        return recovery, observed

    def test_api_restart_failure_does_not_skip_caddy(self):
        def restart(path, service):
            if service == 'api':
                raise RuntimeError('synthetic restart failure')
        with patch.object(installer, 'up', side_effect=restart) as up, \
                patch.object(installer, 'inspect', return_value={'State': {'Running': True}}), \
                patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_INCOMPLETE'):
                installer.rollback_services(['api', 'caddy'])
        self.assertEqual([call.args[1] for call in up.call_args_list], ['api', 'caddy'])

    def test_api_health_failure_does_not_skip_caddy(self):
        with patch.object(installer, 'up') as up, \
                patch.object(installer, 'health', side_effect=RuntimeError('synthetic health failure')), \
                patch.object(installer, 'inspect', return_value={'State': {'Running': True}}), \
                patch('builtins.print'):
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_INCOMPLETE'):
                installer.rollback_services(['api', 'caddy'])
        self.assertEqual([call.args[1] for call in up.call_args_list], ['api', 'caddy'])

    def test_both_restart_failures_are_attempted_and_reported(self):
        with patch.object(installer, 'up', side_effect=RuntimeError('synthetic restart failure')) as up, \
                patch('builtins.print') as output:
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_INCOMPLETE'):
                installer.rollback_services(['api', 'caddy'])
        self.assertEqual([call.args[1] for call in up.call_args_list], ['api', 'caddy'])
        output.assert_called_once_with('UPDATE_ROLLBACK_FAILED_SERVICES=api,caddy', flush=True)

    def test_later_deployment_of_either_service_blocks_all_mutation(self):
        for service in ('api', 'caddy'):
            for kind in ('image', 'config'):
                recovery, observed = self.fixture()
                if kind == 'image':
                    observed[service]['Image'] = 'sha256:future-release'
                else:
                    observed[service]['Config']['Labels']['com.docker.compose.project.config_files'] = '/private/v13.json'
                with self.subTest(service=service, kind=kind), \
                        patch.object(installer, 'observe_recovery', return_value=observed), \
                        patch.object(installer, 'rollback_services') as rollback:
                    with self.assertRaisesRegex(RuntimeError, 'LATER_DEPLOYMENT_PRESENT'):
                        installer.guarded_rollback(recovery, ['api', 'caddy'])
                    rollback.assert_not_called()

    def test_known_or_absent_container_allows_recovery(self):
        recovery, observed = self.fixture()
        installer.recovery_guard(recovery, observed)
        observed['api'] = None
        installer.recovery_guard(recovery, observed)

    def test_docker_failure_is_not_misread_as_missing_containers(self):
        with patch.object(installer, 'run', side_effect=RuntimeError('daemon unavailable')):
            with self.assertRaisesRegex(RuntimeError, 'daemon unavailable'):
                installer.observe_recovery()

    def test_v9_recovery_build_accepts_additive_table_counts(self):
        api = {'Config': {'Image': 'outdoor-fit-api:20260928-v9'}, 'Image': 'sha256:original-v9'}
        state = MagicMock()
        folder = state.__truediv__.return_value
        source = folder.__truediv__.return_value
        source.read_text.return_value = 'if (Number(tables?.count) !== 40) throw Error();'
        with patch.object(installer, 'STATE', state), patch.object(installer, 'run') as run, \
                patch.object(installer, 'image_id', return_value='sha256:compatible-v9'):
            self.assertEqual(installer.rollback_image(api, 'base'), 'sha256:compatible-v9')
        self.assertTrue(any('![40, 41, 42].includes(Number(tables?.count))' in call.args[0]
                            for call in source.write_text.call_args_list))
        self.assertTrue(any(call.args[0][:2] == ['docker', 'build'] for call in run.call_args_list))


    def test_v10_and_v11_build_compatible_recovery_before_schema_changes(self):
        for version in ('20260928-v10', '20260930-v11'):
            api = {'Config': {'Image': 'outdoor-fit-api:' + version}, 'Image': 'sha256:original'}
            state = MagicMock()
            source = state.__truediv__.return_value.__truediv__.return_value
            source.read_text.return_value = 'if (Number(tables?.count) !== 41) throw Error();'
            with self.subTest(version=version), patch.object(installer, 'STATE', state), patch.object(installer, 'run') as run, patch.object(installer, 'image_id', return_value='sha256:compatible'):
                self.assertEqual(installer.rollback_image(api, 'base'), 'sha256:compatible')
            self.assertTrue(any('![40, 41, 42].includes(Number(tables?.count))' in call.args[0] for call in source.write_text.call_args_list))
            self.assertTrue(any(call.args[0][:2] == ['docker', 'build'] for call in run.call_args_list))



class PackagingSafety(unittest.TestCase):
    def test_reuse_requires_all_three_baselines(self):
        name = 'web/assets/image.png'
        self.assertTrue(packager.reusable_web(name, 'new', {'v9': {name: 'new'}, 'v10': {name: 'new'}, 'v11': {name: 'new'}}))
        for baselines in ({'v9': {name: 'old'}, 'v10': {name: 'new'}, 'v11': {name: 'new'}}, {'v9': {}, 'v10': {name: 'new'}, 'v11': {name: 'new'}}, {'v9': {name: 'new'}, 'v10': {name: 'new'}, 'v11': {name: 'old'}}, {}):
            self.assertFalse(packager.reusable_web(name, 'new', baselines))

    def test_existing_archive_or_checksum_stops_before_read_or_write(self):
        for occupied in ('archive', 'checksum', 'symlink'):
            output, checksum = MagicMock(), MagicMock()
            output.exists.return_value = occupied == 'archive'
            checksum.exists.return_value = occupied == 'checksum'
            output.is_symlink.return_value = occupied == 'symlink'
            checksum.is_symlink.return_value = False
            with self.subTest(occupied=occupied), patch.object(packager, 'OUT', output), \
                    patch.object(packager, 'CHECKSUM', checksum), patch.object(packager, 'read_baselines') as read:
                with self.assertRaisesRegex(RuntimeError, 'ALREADY_SEALED'):
                    packager.seal(Path('/unused/web'))
            read.assert_not_called()
            output.open.assert_not_called()
            checksum.open.assert_not_called()

    def test_public_packager_guard_precedes_helpers_and_refuses_all_existing_outputs(self):
        tree = ast.parse((ROOT / 'scripts/package-public-website.py').read_text(encoding='utf-8'))
        guard_index = next(i for i, item in enumerate(tree.body) if isinstance(item, ast.If))
        helper_index = next(i for i, item in enumerate(tree.body) if isinstance(item, ast.Expr)
                            and isinstance(item.value, ast.Call) and isinstance(item.value.func, ast.Attribute)
                            and item.value.func.attr == 'run')
        self.assertLess(guard_index, helper_index)
        guard = compile(ast.fix_missing_locations(ast.Module(body=[tree.body[guard_index]], type_ignores=[])), '<guard>', 'exec')
        for occupied in range(3):
            outputs = [MagicMock() for _ in range(3)]
            for i, output in enumerate(outputs):
                output.exists.return_value = i == occupied
                output.is_symlink.return_value = False
            with self.subTest(occupied=occupied), self.assertRaisesRegex(SystemExit, 'ALREADY_SEALED'):
                exec(guard, {'SEALED_OUTPUTS': outputs})

    def test_private_and_escape_payloads_refused(self):
        for name in ['web/../secret', '/etc/passwd', 'web/.env', 'web/secrets/x', 'web/key.pem', 'web/app.js.map',
                     'server/src/node_modules/secret.js', 'web/assets/node_modules/package/secret.js',
                     'web/assets/node_modules/package/.env']:
            with self.subTest(name=name), self.assertRaises(RuntimeError):
                packager.safe_relative(name)

    def test_exported_dependency_icons_and_fonts_are_public_web_assets(self):
        for name in ['web/assets/node_modules/expo-router/assets/back.123.png',
                     'web/assets/node_modules/@expo/vector-icons/Fonts/icon.123.ttf']:
            packager.safe_relative(name)


if __name__ == '__main__':
    unittest.main()
