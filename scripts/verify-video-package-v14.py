"""Offline verification of the actual sealed archive; no production requests."""
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tarfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
PREFIX = 'outdoor-fit-video-capacity-20261003-v14'
ARCHIVE = ROOT / 'deploy/video-capacity-20261003-v14' / (PREFIX + '-delta.tar.gz')
OUTPUT = ROOT / 'workspace-artifacts/video-capacity-20261003-v14'
EXTRACT = OUTPUT / 'package-verification-extract'
EXPECTED_SHA = '9ed4e76966eb758af1ed165f4170da2315d72a022d1c60f8da14f67dce0ccac9'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def main():
    checksum = hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()
    require(checksum == EXPECTED_SHA, 'ARCHIVE_SHA_MISMATCH')
    require(not EXTRACT.exists(), 'EXTRACT_ALREADY_EXISTS')
    receipt = json.loads((ROOT / 'workspace-artifacts/app-suggestions-20261002/private/test-accounts.json').read_text(encoding='utf-8'))
    require(len(receipt) == 50, 'ACCOUNT_RECEIPT_INVALID')
    private_values = {record[key].encode('utf-8') for record in receipt for key in ('email', 'password')}
    require(all(len(value) >= 8 for value in private_values), 'PRIVATE_SCAN_VALUE_INVALID')
    scanned = 0
    EXTRACT.mkdir()
    try:
        with tarfile.open(ARCHIVE, 'r:gz') as archive:
            members = archive.getmembers()
            require(len({member.name for member in members}) == len(members), 'ARCHIVE_DUPLICATE')
            for member in members:
                relative = PurePosixPath(member.name)
                require(member.isfile() and relative.parts[0] == PREFIX and not relative.is_absolute()
                        and '..' not in relative.parts and '\\' not in member.name, 'ARCHIVE_UNSAFE_MEMBER')
                require(not any(part.lower() in {'private', 'credentials', 'secrets'} for part in relative.parts),
                        'ARCHIVE_PRIVATE_PATH')
                content = archive.extractfile(member).read()
                require(not any(value in content for value in private_values), 'ARCHIVE_TEST_CREDENTIAL')
                if relative.suffix.lower() in {'.js', '.json', '.html', '.py', '.md', '.txt', '.css'}:
                    require(not re.search(rb'eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', content),
                            'ARCHIVE_JWT_TOKEN')
                destination = EXTRACT.joinpath(*relative.parts)
                require(EXTRACT.resolve() in destination.resolve().parents, 'EXTRACT_PATH_ESCAPE')
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
                scanned += 1
        package = EXTRACT / PREFIX
        spec = importlib.util.spec_from_file_location('verified_video_v14_install', package / 'install.py')
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        require(installer.PACKAGE == package, 'INSTALLER_PACKAGE_MISMATCH')
        manifest = installer.verify_package()
        videos = json.loads((package / 'media/manifest.json').read_text(encoding='utf-8'))['entries']
        require(len(videos) == 54, 'PUBLIC_VIDEO_COUNT_MISMATCH')
        report = {
            'ok': True, 'archiveSha256': checksum, 'archiveBytes': ARCHIVE.stat().st_size,
            'archiveFiles': scanned, 'installerVerifyPackagePassed': True,
            'publicVideoDerivatives': len(videos),
            'privacy': {'knownAccountEmailsAndPasswordsAbsent': True, 'jwtTokensAbsent': True,
                        'privatePathsAbsent': True},
            'productionRequests': 0, 'productionDeployed': False, 'cdnEnabled': False,
            'production50UserRetestStarted': False,
        }
        (OUTPUT / 'package-verification.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report))
    finally:
        require(EXTRACT.resolve().parent == OUTPUT.resolve() and not EXTRACT.is_symlink(), 'CLEANUP_PATH_INVALID')
        shutil.rmtree(EXTRACT)


if __name__ == '__main__':
    main()
