"""Version-bound the next authorized retest scripts. Never start a load test."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'workspace-artifacts/load-test-20261003-v14'
for name in ('load-test.cjs', 'fresh-learning-test.cjs', 'range-test.cjs', 'verify-v14.py'):
    path = OUT / name
    text = path.read_text(encoding='utf-8')
    text = text.replace('v13', 'v14').replace('load-capacity-20261002-v14-web', 'video-capacity-20261003-v14-web')
    text = text.replace('OUTDOOR-FIT-authorized-range-health/20261002', 'OUTDOOR-FIT-authorized-range-health/20261003-v14')
    text = text.replace('OUTDOOR-FIT-authorized-range-metadata/20261002', 'OUTDOOR-FIT-authorized-range-metadata/20261003-v14')
    path.write_text(text, encoding='utf-8')
print('V14_RETEST_PREPARED_NOT_STARTED=PASS')
