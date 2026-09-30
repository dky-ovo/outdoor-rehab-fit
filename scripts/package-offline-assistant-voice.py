"""Package this change's source/resources only. Not an APK or server installer."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUTS = {
    'initial': ROOT / 'deploy/2026-09-21/outdoor-fit-offline-voice-reply-20260921-source.zip',
    'r2': ROOT / 'deploy/2026-09-21/outdoor-fit-offline-voice-r2-20260921-source.zip',
}
FILES = [
    '.easignore', '.gitignore', 'app.config.js', 'package.json', 'package-lock.json',
    'app/(tabs)/chat/index.js',
    'components/AssistantReplySpeechControls.js', 'components/AssistantVoiceInput.js',
    'components/__tests__/AssistantReplySpeechControls-test.js',
    'components/__tests__/AssistantReplySpeechIntegration-test.js', 'components/__tests__/AiCamera-test.js',
    'constants/AssistantVoice.js',
    'hooks/useAssistantReplySpeech.js', 'hooks/useAssistantVoiceInput.js',
    'hooks/__tests__/useAssistantReplySpeech-test.js', 'hooks/__tests__/useAssistantVoiceInput-test.js',
    'utils/assistantAudioCoordination.js', 'utils/assistantReplySpeech.js',
    'utils/assistantVoiceSession.js', 'utils/offlineAssistantVoice.js',
    'utils/__tests__/assistantReplySpeech-test.js', 'utils/__tests__/offlineAssistantVoice-test.js',
    'utils/__tests__/nativeTimerAppConfig-test.js',
    'scripts/build-android-preview.ps1', 'scripts/package-offline-assistant-voice.py',
    'docs/offline-assistant-voice-20260921.md',
]
REVISION_FILES = [
    'components/AssistantVoiceDiagnostics.js',
    'components/__tests__/AssistantVoiceDiagnostics-test.js',
    'plugins/withOfflineVoicePackaging.js',
    'plugins/__tests__/OfflineVoicePackaging-test.js',
    'plugins/__tests__/withOfflineVoicePackaging-integration-test.cjs',
    'utils/__tests__/assistantVoiceSession-test.js',
    'scripts/verify-offline-voice-apk.py',
    'scripts/__tests__/verify_offline_voice_apk_test.py',
    'docs/offline-assistant-voice-r2-20260921.md',
]


def sha(file):
    result = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--revision', choices=OUTPUTS, default='r2')
    args = parser.parse_args()
    OUTPUT = OUTPUTS[args.revision]
    if OUTPUT.exists():
        raise RuntimeError('Release file already exists; do not silently overwrite a delivered package')
    module = ROOT / 'modules/offline-assistant-voice'
    files = [ROOT / name for name in FILES + (REVISION_FILES if args.revision == 'r2' else [])]
    files += [file for file in module.rglob('*') if file.is_file()
              and not any(part in ('build', '__pycache__', '.gradle') for part in file.relative_to(module).parts)]
    files = sorted(set(files))
    inventory = []
    for file in files:
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(ROOT):
            raise RuntimeError(f'Unsafe or missing input: {file}')
        relative = file.relative_to(ROOT).as_posix()
        if any(part in ('.env', 'node_modules', 'data') for part in file.relative_to(ROOT).parts):
            raise RuntimeError('Unexpected private/dependency path')
        inventory.append({'path': relative, 'size': file.stat().st_size, 'sha256': sha(file)})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file, record in zip(files, inventory):
            archive.write(file, record['path'])
        archive.writestr('SOURCE-PACKAGE-MANIFEST.json', json.dumps({'type': 'source-increment-not-apk-not-server', 'files': inventory}, ensure_ascii=False, indent=2))
    with zipfile.ZipFile(OUTPUT) as archive:
        broken = archive.testzip()
        if broken:
            raise RuntimeError(f'Archive CRC failed: {broken}')
    checksum = sha(OUTPUT)
    OUTPUT.with_suffix('.zip.sha256').write_text(f'{checksum}  {OUTPUT.name}\n', encoding='ascii')
    print(json.dumps({'path': str(OUTPUT), 'bytes': OUTPUT.stat().st_size, 'sha256': checksum, 'sourceFiles': len(files)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
