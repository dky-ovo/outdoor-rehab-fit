#!/usr/bin/env python3
"""Update the two reviewed website files in place; never restart services."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import zlib

BASE = Path('/opt/outdoor-fit/production')
WEB = BASE / 'releases/public-website-20260928-v1/website'
CADDY = 'outdoor-fit-production-caddy-1'
PROFESSOR = b'https://www.polyu.edu.hk/comp/people/academic-staff/prof-ng-hiu-fung-peter/'
# Reviewed final files are embedded below; only known v1/profile-patched hashes are accepted.
PARTNER_URLS = ['https://www.polyu.edu.hk/tc/about-polyu/', 'https://www.twc.edu.hk/tc/twc/About_TWC/vision_and_mission', 'https://www.feinberg.northwestern.edu/about/index.html', 'https://www.hkcc-polyu.edu.hk/tc/about-hkcc/college-overview/index.html', 'https://www.hkpfa.org.hk/CP/pG/2/1/6']
PAYLOADS = {'index.html': {'acceptedSha256': ['864de7e4e48faefd7fc3da9c8bfe6ba132bcae854e0f51c081c3071c89c30cd1', '0b8481adcca546be80e1068b9d7f5762ab56dc95e037f3e4713b1f924d63c3ef', '845f418f3d451070a97b3049038e234ab5a4b4caf3b8f13928552e26c22ddf86'], 'sha256': '845f418f3d451070a97b3049038e234ab5a4b4caf3b8f13928552e26c22ddf86', 'data': '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'}, 'site.css': {'acceptedSha256': ['aa887615fdfddfd3487228f8def21817d47914bb088652ff4feb14f4913cbf57', 'bb0dbbabebf41bfe4983d317daac2daabee580fff0fd2c2b73fb142be0629f22'], 'sha256': '9467df627ec0d08bed6842d41dedf5e3c90ac0bf8b5835a6b37c0e65b59ba884', 'data': 'eNqVWkuv40gV3vevKNQaddLYaduxc3MdMRrETGsEQiCBBGjUi4pdTmqu4zK2cx9jRWLFhi0CFkiIBVvEFvFvEDB/g1On/KjyI/f2ovvGdvnUeZ/vnPK7t+RnvGIko/f8QCsuMovQKGJlyfcpIzyrWEEjeb8kNIvJScjfhMYxi0klSHVkRBT8wDOakpiV/JCtyNt3r/YifqoTkVV2Qk88fQrf/II/kh/TmCWiID9nj9Ub681PeXZ4T7MD+fJHcPVjHhWiFElFfnhk2eFLxt9YJc1Ku2QFTy6vjq519Kzj2jr6tbhnRZKKB/uhoHm4Lxi9sx9EEV9elQy5/YrHH+oSCKapfaIF8GdXIg9dx88fL69W5R3P7ZRnd3UuSi5fCBP+yOKdXLTNH3cpS6rQ9eDXNzbPYvYIrzq7SKSiCF8nSbLb0+juUIhzFof3tFjYchchsuUuB92AXPgy8RygsAfGWGEXNObnEqlXBcgFijiF+CulFfvVwnYD55OlzlyYiOhc1pOrHVwJprOPDLRa9IKUFY/unlASp+M+cHSOi8OeLrwgsLxgDf88a3UbLFs+96KqxCl0gf1SpDwmuNr1Hcu7tYJba+UukVZciNxOeAoeEu7Tc7FwQbSlkk1xshePdnmksXggq3Vp8rtSxmFx3a8KHQIkyBqURmypOrX1jS939l1r5W2l1OCraPf6gcfVMTzxbOGu5XIromm0AEN9QmyyAUsvlztl/JCeK7GDlbA7PxyrcCvNEPMyT+lTmKTscUdT8F0bGDyVYcSk3+++PoMukyc7Aj+GO2GZ04jZe1Y9MJbtDuB53hbdaQ8yx/Vz5OQL6FIVuL8ds0gUGHFhJjLW+JbuS3ZMi7vlDqPoQbF9A06I1yX/hoXoXeAorJXKXfk7uTvos5D+47S8EX461KYfuvJlpUFfKqMh4WsS2eV530m1T0V0p22OkqSsAslsqRjp8ytnw06GJMCFLWPaFCNwgLPX6A1gTFNxqFaw3YQGtXcIrTVW/JcodZqVDWi0C52CQXDxe7Z7OMp90N5ASDqbGdeO7ua4CVl5pcFfeJRJytLufEULTu3oXBQgzYd6bPClSSAT1QKdneb5MgxpAiqoW19886Znm+4hUM8V2zWhe9MmMGdXoJBOa11ps9nM1eeZEgKJ/RJyTH/PVlk+lHR14bsFMwpo+J7XQyvYaHfXUEeriLqzg8wP7uaaQErDaMtBEr69vUU3h8Ihidl5IQ4FFL1a09Osem23168KIJlydDZkTNLCPsjdQMbFrROzg2Uw11wdRBovP0L1wPOJZWcoZodDyrrIQWfXGFDXKLKWyNWWkrnlbj4ZbLRkIH/rjr8Dq5Wg01xwFZA6NwTiJRvkC02fTSb2MXxmbNakvBn/CkpLyExTPeGFubvyKvYIPAA2+V5VnNkH5Agqe1FWdnTkaTxdS0HKJSlEBRcLPwBTLV9KOquOivDCW9YNb5h1X/R2Sq/zZeuM2R1nR1YIKLyHc8Ewr9OMn1TOY78+8xy2BtSVClqRm5IwWjJIfbY4V4DmEp5BMDQ02lBqKz7wTVf0nla0+CqG/2VUQH1ndkr3LP0wzEC0qorFeN2AQ9vem0xCjpbuYa9X0oKf3bGnpKAnBpyazNfOJ5aMq1n4E8w9s6U3Ly8tHynEuKYjvIflhKy2JQHZjwYb/fM6KcSpt+o0apMZaHmpRLfO3c0xjPnmntHUlmnn6TnKnjeAU53vN2a1tNiAW9F5zyNAJ99wVixWgOk2gbVaWzKNGvuueGnfc8T3k0zL3AGv5AwiPavnQ1FHd+oaM0pbDTE+FZGmFLZXiGrtB14deTZjwUCKrhMMhyB0LZ9rwNFF5LhF5LgZI0d/2Tv3IEVN1OFJMNETQIeeVoyUul2mxO4X9/l94a6cdaCxNKru//vL37798+/++/c//e8P//z2H3/9z79+R/792z9eqfmYwVW1x5+qgXG0/A2ogNy2QAnBVQtMr3cGm+XHVBIJJTVktobLZ/x8M+fmXmkN0IWp2RZadHeVYzW+3ar0WReX0OLEAFAqR+AZZABezbjA4B3FSD1cC5pkhdSO9gJNkgFkxQRF4zDcy6aYjZ9G4pRTSPKriBYxya1VWbFc/s0L9TeiUD/ks5Rbq4TRSpYEuA8+gfetFQcKUQWWKitYpG+xabbIKrkAqQxVYHbZNHt6gPtSJsBhkOzPWXSs9eZaVvm2yZHdXgVS2XsaH1hprFMtBnukp7ytGl1M8gwbmlG3AY70HRBGFBXNqs6nJZhAJ5/DEwrwmy4aSBwzDnqNfANVPMQqpLEGGhlnBlMZQ2M1aENAazGMlNN2wokQ0kNbYQK1nTfAtK+TDYtY0gqBGpwMxEFDNNn7wNZqVwCnvG9Z5cVO/mdDu5XLuJRp93zKABomBZHdM4EfaF0EhXpzVkLsVaZML40m45Xngmk32TG18qgeXNPBdmCGm26AM0acve1NBZFcd1zlt/pjvXt9Roet+tRcyNdJqRRutsEvmD1oyR3Zk8OIncbu2uuHTy/ymrVq/cH15PrhaEwVF2zNm5qDv9sJk987OWoCfgHDxgCkaTB8rcHwR/OxQLZSV+vN83MsDRcEzRSOvN747tq7dbcvLvj6pEWqEgsLT2UxOfI4BjMMKtuofmnaXLWQS6PS3OrIuIjUSnEuIlbaOkQPb3DqQIJBAz9sNAEgyU7z9fvvf/H5exf+vn//+fsfkBs1WGRPbF+Ih+fylz8ROMNBj+uxU+trLQLxmpZaF4AcXS0moxRS/sKXo7rN/YO1wYHh7ODLnGx5Y9p5PT3f0WvNZsCUrISdVtExHLLdGouwGL4krL0tziCawF7rzbLvqDZ3ZqSq+fNwY8SLJkLVhgyNOnCcScucQelGjw39d+ud2H8tbyS8CiOZSodN/uSwZA/JA5r5MR9HT7McFiXTIMHQKZwJEl0h6Gw0B64nXm0KwnTa75afWEXrK4O+3qmbsq4meKMd8+eJbPoE25pUuQ4UQB4BlsGx9Ik+2spk21GODvQbDY3tmMZU2MixuOVD2PiImIfGmA0jA8xo+/RHNH29NIneXkGAGpGuSGKaHO0x4UjNchkxEl9tDPnxHTpjdWPRxFBbmfmxlSFAAxhxAXiXZ4ZSMJiGAM3Y6Jxa5g2RdsMT1WitAnaSeEb5kzpZ0pLMR+FT1xvUcdTPZycWc7pQnY8MmWU97B7nWp3B1P7SEes91XWlZy7rfiiPWAWq56U/b8Fbm25SqJ+2+DhyWU2BsMvM0H49w4njICf9ttqxzY1UxeQEVNltfKaA8o+7ZqnXm814Tj6yU06hgdNO9TYNeiOeBl2u5ffBmALxSIBjCq9HJUGge22r2Pj+CKq9wXBvIxFTfy/nSuQs+1gI2rI/Z5nh1PcyMYYfTxFMoKzYULuH7jvbvRiNx1UmjaWfxvxen5SO6F4/8b11pt1ss1VehuO+ilfgSmbyA4bxGYC0M01rrQb3RNY3Tp/NHEwkzVs8yyAgUdlSgeZElA4nouemEm7Li3byNoja4bmnHn4S6rfhh8QbqO1pUBtpvMgG/dHmSw2hJJ/rjLChwXNJLCN4nNYe811mmiCFfAb1aLCY5N8d9WcDFPeMjN7oDdSeFouezIuXq9BorS8Y4HZ5nAoVsW+qmhHdpu+isPxdGxMZM6fhCKeb9WCaVGaH/cpzLhva2sCjSt85VDJwTjsVB1HOKKhgOaPVwrOAKChj4VigsuVy8PKnUletdYxZo+JbTrekrkwrri+v6V4eR3TPR0gH3rZcR0Kd7RjqeFPh7K9VOFeMnq5594xg/diqnXu3ktyqqSkxrTS0RHDFhOgeDV/inDfHUSKxq6eckWc5xnyoZamRsrZSWe7Kb9XVJhucm5R1L5m6IxXGar2P6D+j8PArio13/7DslkPUc/l9iV5Qu4cQfHctLR8DRY4GkVHTsOvuYfO5CrLltzc54LK6Tcx9zpK/e2vnBUtAIrtg8Tlisa2+RQrV5bI+Vqe0LQB7dqT3HPCjFFAb7ry13rbjVvlLwab+bEjKpo0BtabefHKZPsgZjZhHR3XD5/r5yPBhKzfJC+jPav3jGavLJ5b2KZNpoZdx2BTPWn1CxUHcmIX0XsgBThMBawXqBxO9izHCHBw9A++v3r0lP0kSHnGakiZryM/JCgHWwm/IJM8l+fdvfk88x9vYzq3tbfHbMWpkmXr8dUaHrDftJ1Yv/KJm9mR5dHo1ON7CswedK63I6n35AB+0x0b6m8ZxdKdjt4GFo9Xq6GxIQj/oqI1zMlNcE3u2NYDYeFqmjtQcSIHNGVmwnPkybS3TyqurTEBCl2k6XA8wcMtJ8xzyXlKyKvS1lmYEysyNrCv6my8+L80aH6/uUZiCp38BsEs87+3o3v8HrEcSVw=='}}


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args):
    result = subprocess.run(args, capture_output=True, timeout=20)
    require(result.returncode == 0, 'LINKS_COMMAND_FAILED')
    return result.stdout


def decode_payloads():
    require(set(PAYLOADS) == {'index.html', 'site.css'} and len(PARTNER_URLS) == 5,
            'LINKS_PAYLOAD_INCOMPLETE')
    result = {}
    for name, item in PAYLOADS.items():
        data = zlib.decompress(base64.b64decode(item['data'], validate=True))
        require(sha(data) == item['sha256'], 'LINKS_PAYLOAD_HASH_MISMATCH')
        result[name] = data
    page = result['index.html']
    require(page.count(b'href="' + PROFESSOR + b'"') == 2, 'LINKS_PROFESSOR_COUNT_INVALID')
    for url in PARTNER_URLS:
        require(page.count(('href="' + url + '"').encode()) == 1, 'LINKS_PARTNER_COUNT_INVALID')
    return result


def atomic_write(path, data, metadata, restore_time=False):
    descriptor, temporary = tempfile.mkstemp(prefix='.website-links-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        shutil.copystat(path, temporary, follow_symlinks=False)
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        os.utime(temporary, ns=(metadata.st_atime_ns,
                               metadata.st_mtime_ns if restore_time else time.time_ns()))
        os.replace(temporary, path)
        if hasattr(os, 'O_DIRECTORY'):
            directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def update(web, backup_parent, verify):
    desired = decode_payloads()
    before, metadata = {}, {}
    for name in desired:
        path = web / name
        require(path.is_file() and not path.is_symlink() and path.stat().st_nlink == 1,
                'LINKS_FILE_NOT_REGULAR')
        metadata[name] = path.stat()
        before[name] = path.read_bytes()
        require(sha(before[name]) in PAYLOADS[name]['acceptedSha256'] + [PAYLOADS[name]['sha256']],
                'LINKS_UNKNOWN_EXISTING_FILE_' + name.replace('.', '_').upper())
    changes = [name for name in desired if before[name] != desired[name]]
    if not changes:
        verify(desired)
        print('LINKS_UPDATE=ALREADY_CURRENT')
        return
    require(backup_parent.is_dir() and not backup_parent.is_symlink(), 'LINKS_BACKUP_PARENT_INVALID')
    backup = Path(tempfile.mkdtemp(prefix='website-links-20260928-', dir=backup_parent))
    backup.chmod(0o700)
    for name, data in before.items():
        saved = backup / (name + '.before')
        saved.write_bytes(data)
        saved.chmod(0o600)
    print('LINKS_BACKUP_DIR=' + str(backup), flush=True)
    touched = []
    try:
        for name in changes:
            path = web / name
            require(path.read_bytes() == before[name] and path.stat().st_ino == metadata[name].st_ino,
                    'LINKS_CONCURRENT_EDIT_DETECTED')
            touched.append(name)
            atomic_write(path, desired[name], metadata[name])
        verify(desired)
    except BaseException:
        restored = True
        for name in reversed(touched):
            path = web / name
            try:
                current = path.read_bytes()
                if current == desired[name]:
                    atomic_write(path, before[name], metadata[name], restore_time=True)
                elif current != before[name]:
                    restored = False
            except BaseException:
                restored = False
        print('LINKS_ROLLBACK=' + ('COMPLETE' if restored else 'NEEDS_REVIEW_NO_OVERWRITE'), flush=True)
        raise
    print('LINKS_UPDATED_FILES=' + ','.join(changes)
          + '\nLINKS_PROFESSOR_HREFS=2\nLINKS_PARTNER_HREFS=5\nLINKS_SERVED_FILES=PASS\nLINKS_UPDATE=PASS',
          flush=True)


def main():
    import fcntl
    os.umask(0o077)
    require(os.geteuid() == 0, 'LINKS_ROOT_REQUIRED')
    require(WEB.is_dir() and WEB.resolve() == WEB, 'LINKS_RELEASE_PATH_CHANGED')
    live = json.loads(run(['docker', 'inspect', CADDY]))[0]
    require(live['State']['Running'], 'LINKS_CADDY_NOT_RUNNING')
    mounts = [item for item in live['Mounts'] if item['Destination'] == '/srv/website']
    require(len(mounts) == 1 and mounts[0]['Type'] == 'bind' and mounts[0]['Source'] == str(WEB)
            and mounts[0]['RW'] is False, 'LINKS_WEBSITE_MOUNT_CHANGED')

    def verify(expected):
        for name, data in expected.items():
            resource = '/' if name == 'index.html' else '/site.css'
            served = run(['docker', 'exec', CADDY, 'wget', '-q', '-O', '-',
                          '--header=Host: outdoorfit.hk', 'http://127.0.0.1:8099' + resource])
            require(sha(served) == sha(data), 'LINKS_SERVED_FILE_MISMATCH')

    with (BASE / '.public-website.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        update(WEB, BASE / '.update-state', verify)


if __name__ == '__main__':
    try:
        main()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (Exception, KeyboardInterrupt):
        print('LINKS_UPDATE_FAILED_NO_SECRETS_LOGGED', file=sys.stderr)
        sys.exit(1)
