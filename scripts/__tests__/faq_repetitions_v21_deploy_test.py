"""Offline checks for v21's exact v20 source/web pair and complete payload."""
import copy
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load('v21_installer', 'deploy/faq-repetitions-20261007-v21/install.py')
packager = load('v21_packager', 'scripts/package-faq-repetitions-v21.py')


class SealedBaselines(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.known = packager.baselines()

    def test_old_hashes_come_from_sealed_archives(self):
        self.assertEqual(set(self.known), set(installer.BASELINE_SOURCES))
        for name, row in self.known.items():
            self.assertEqual(row['sourceFiles'], installer.BASELINE_SOURCES[name])
            self.assertEqual(installer.web_digest(row['webFiles']), installer.BASELINE_WEB_DIGESTS[name])
        self.assertEqual(len(installer.UPDATE_SOURCE), 17)
        self.assertEqual(installer.NEW_SOURCE, set())

    def test_docker_context_and_copy_include_every_updated_module(self):
        support = ROOT / 'deploy/faq-repetitions-20261007-v21'
        ignore = (support / 'Dockerfile.dockerignore').read_text().splitlines()
        docker = (support / 'Dockerfile').read_text()
        copied = next(line for line in docker.splitlines() if line.startswith('COPY ')).split()[2:-1]
        self.assertEqual(set(copied), installer.UPDATE_SOURCE)
        for name in installer.UPDATE_SOURCE:
            self.assertIn('!' + name, ignore)
            self.assertIn('node --check /app/src/' + Path(name).name, docker)

    def preflight(self, source, web, *, mounts=None, ports=None):
        with tempfile.TemporaryDirectory(prefix='outdoor-fit-v21-preflight-') as temporary:
            base = Path(temporary).resolve()
            (base / '.update-state').mkdir()
            (base / 'releases').mkdir()
            containers = {
                'api': {'State': {'Running': True}, 'Mounts': mounts or [],
                        'HostConfig': {'PortBindings': ports or {}, 'NetworkMode': 'bridge'}},
                'caddy': {'State': {'Running': True}, 'Mounts': []},
            }
            names = {value: key for key, value in installer.CONTAINERS.items()}
            with patch.multiple(installer, BASE=base, STATE=base / '.update-state/new', RELEASE=base / 'releases/new'), \
                 patch.object(installer, 'inspect', side_effect=lambda name: containers[names[name]]), \
                 patch.object(installer, 'capture', return_value={}), \
                 patch.object(installer, 'source_hashes', return_value=source), \
                 patch.object(installer, 'mounted_file', return_value=base / 'web'), \
                 patch.object(installer, 'inventory', return_value=web), \
                 patch.object(installer, 'run', return_value='') as run:
                result = installer.preflight({'baselines': self.known})
                self.assertTrue(all(call.args[0][:3] == ['docker', 'image', 'ls'] for call in run.call_args_list))
                return result[-1]

    def test_same_server_source_accepts_each_exact_v20_web_variant(self):
        sources = list(installer.BASELINE_SOURCES.values())
        self.assertEqual(sources[0], sources[1])
        for name, row in self.known.items():
            self.assertEqual(self.preflight(row['sourceFiles'], row['webFiles']), name)

    def test_drifted_evidence_is_rejected_before_any_service_mutation(self):
        row = next(iter(self.known.values()))
        for value in (None, '0' * 64):
            source = {**row['sourceFiles'], 'server/src/assistantSymptomEvidence.js': value}
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_BASELINE_MISMATCH'):
                self.preflight(source, row['webFiles'])

    def test_unknown_and_partial_web_trees_are_rejected(self):
        row = next(iter(self.known.values()))
        for web in ({**row['webFiles'], 'web/extra.js': 'a' * 64},
                    {key: val for key, val in row['webFiles'].items() if key != 'web/index.html'},
                    {**row['webFiles'], 'web/index.html': 'a' * 64}):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_WEB_BASELINE_MISMATCH'):
                self.preflight(row['sourceFiles'], web)

    def test_changed_existing_language_module_refused(self):
        row = next(iter(self.known.values()))
        source = {**row['sourceFiles'], 'server/src/assistantLanguage.js': '1' * 64}
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_BASELINE_MISMATCH'):
            self.preflight(source, row['webFiles'])

    def test_existing_guide_and_tcm_must_match_the_sealed_v20_payload(self):
        row = next(iter(self.known.values()))
        for name in ('server/src/assistantGuideAnswers.js', 'server/src/assistantTcm.js'):
            self.assertRegex(row['sourceFiles'][name], r'^[a-f0-9]{64}$')
            for value in (None, 'a' * 64):
                with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_BASELINE_MISMATCH'):
                    self.preflight({**row['sourceFiles'], name: value}, row['webFiles'])

    def test_mounted_source_and_public_api_port_refused(self):
        row = next(iter(self.known.values()))
        for target in ('/app', '/app/src', '/app/src/assistantFaqKnowledge.js'):
            with self.assertRaisesRegex(RuntimeError, 'UPDATE_SOURCE_MOUNT_SHADOWS_IMAGE'):
                self.preflight(row['sourceFiles'], row['webFiles'], mounts=[{'Destination': target}])
        with self.assertRaisesRegex(RuntimeError, 'UPDATE_API_PUBLIC_PORT_REQUIRES_REVIEW'):
            self.preflight(row['sourceFiles'], row['webFiles'], ports={'3000/tcp': [{'HostIp': '0.0.0.0'}]})

    def test_literal_dollars_survive_compose_interpolation(self):
        original = {'services': {'api': {'environment': {'PASSWORD': 'a${PRIVATE}b$c'}, 'command': ['$$HOME']}}}
        expected = copy.deepcopy(original)
        expected['services']['api']['environment']['PASSWORD'] = 'a$${PRIVATE}b$$c'
        expected['services']['api']['command'] = ['$$$$HOME']
        self.assertEqual(installer.literal_compose(original), expected)
        self.assertEqual(original['services']['api']['environment']['PASSWORD'], 'a${PRIVATE}b$c')


if __name__ == '__main__':
    unittest.main()
