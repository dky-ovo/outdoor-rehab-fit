"""Package a reply-only source increment; never a backend installer or APK."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'deploy/2026-09-21/outdoor-fit-reply-only-20260921-source.zip'
FILES = [
    '.easignore', '.gitignore', 'app.config.js',
    'app/(tabs)/index.js', 'app/(tabs)/chat/index.js',
    'components/AssistantReplySpeechControls.js',
    'components/__tests__/AiCamera-test.js',
    'components/__tests__/AssistantReplySpeechIntegration-test.js',
    'components/__tests__/HomeOverviewLayout-test.js',
    'hooks/useAssistantReplySpeech.js', 'utils/assistantReplySpeech.js',
    'utils/assistantAudioCoordination.js',
    'utils/__tests__/nativeTimerAppConfig-test.js',
    'modules/offline-assistant-voice/package.json',
    'modules/offline-assistant-voice/index.js',
    'modules/offline-assistant-voice/expo-module.config.json',
    'modules/offline-assistant-voice/LICENSE',
    'modules/offline-assistant-voice/android/build.gradle',
    'modules/offline-assistant-voice/android/consumer-rules.pro',
    'modules/offline-assistant-voice/android/src/main/AndroidManifest.xml',
    'modules/offline-assistant-voice/android/src/main/java/expo/modules/offlineassistantvoice/OfflineAssistantVoiceModule.kt',
    'modules/offline-assistant-voice/android/src/main/java/expo/modules/offlineassistantvoice/OfflineReplySpeaker.kt',
    'modules/offline-assistant-voice/android/src/main/java/expo/modules/offlineassistantvoice/OfflineVoiceSelection.java',
    'modules/offline-assistant-voice/ios/OfflineAssistantVoice.podspec',
    'modules/offline-assistant-voice/ios/OfflineAssistantVoiceModule.swift',
    'modules/offline-assistant-voice/ios/OfflineReplySpeaker.swift',
    'modules/offline-assistant-voice/ios/PrivacyInfo.xcprivacy',
    'modules/offline-assistant-voice/__tests__/OfflineVoiceNativeContract-test.js',
    'modules/offline-assistant-voice/__tests__/OfflineReplySpeakerContract-test.js',
    'scripts/build-android-preview.ps1',
    'scripts/verify-reply-only-config.cjs',
    'scripts/package-assistant-reply-only.py',
    'docs/assistant-reply-only-20260921.md',
]


def sha(file):
    result = hashlib.sha256()
    with file.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def main():
    if OUTPUT.exists():
        raise RuntimeError('Refusing to overwrite a delivered source release')
    inventory = []
    for name in FILES:
        file = ROOT / name
        if not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(ROOT):
            raise RuntimeError(f'Unsafe or missing source: {name}')
        inventory.append({'path': name, 'size': file.stat().st_size, 'sha256': sha(file)})
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUTPUT, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for item in inventory:
            archive.write(ROOT / item['path'], item['path'])
        archive.writestr('SOURCE-PACKAGE-MANIFEST.json', json.dumps({
            'type': 'source-increment-not-apk-not-server',
            'minimumNativeVersion': '1.2.2',
            'files': inventory,
            'note': 'Retired model/vendor files can remain locally; EAS ignores and native build sources exclude them. No runtime database or user files are included.',
        }, indent=2))
    with zipfile.ZipFile(OUTPUT) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('ZIP CRC validation failed')
        for item in inventory:
            if hashlib.sha256(archive.read(item['path'])).hexdigest() != item['sha256']:
                raise RuntimeError('Archived source hash mismatch')
    print(json.dumps({'path': str(OUTPUT), 'bytes': OUTPUT.stat().st_size, 'sha256': sha(OUTPUT), 'sourceFiles': len(inventory)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
