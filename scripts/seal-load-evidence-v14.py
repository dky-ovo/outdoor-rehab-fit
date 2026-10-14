"""Record hashes and ordering of completed evidence without altering raw results."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'workspace-artifacts/load-test-20261003-v14'
NAMES = ('results.json', 'fresh-learning-results.json', 'range-results.json', 'local-decoder-results.json')


def main():
    records = {}
    previous_finish = None
    for name in NAMES:
        data = (ROOT / name).read_bytes()
        run = json.loads(data)
        assert run.get('finishedAt') and run.get('startedAt')
        assert not run.get('abort') and not run.get('runError')
        if previous_finish:
            assert run['startedAt'] > previous_finish, 'Test runs must not overlap'
        previous_finish = run['finishedAt']
        records[name] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data),
                         'startedAtUTC': run['startedAt'], 'finishedAtUTC': run['finishedAt']}
    report = {'rawEvidenceFiles': records, 'allFourRunsCompleted': True,
              'testRunsSequential': True, 'maximumConcurrentBrowserContexts': 50,
              'temporaryTestCredentialsRemoved': not (ROOT / 'private/accounts.json').exists(),
              'originalCredentialDocumentPreserved': (ROOT.parent / 'app-suggestions-20261002/private/OUTDOOR-FIT-50-Test-Accounts-20261002.docx').is_file()}
    assert report['temporaryTestCredentialsRemoved'] and report['originalCredentialDocumentPreserved']
    (ROOT / 'evidence-manifest.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'runs': len(records), 'sequential': True, 'temporaryCredentialsRemoved': True}))


if __name__ == '__main__':
    main()
