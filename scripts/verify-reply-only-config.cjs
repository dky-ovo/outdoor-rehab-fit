// Read-only Expo plugin introspection. Does not run prebuild, write native projects,
// access user records, upload files, publish an OTA, or start an EAS build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ignore = require('ignore');
const { getPrebuildConfigAsync } = require('@expo/prebuild-config');
const { compileModsAsync } = require('@expo/config-plugins');

const projectRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(projectRoot, relative), 'utf8');
const pluginName = plugin => Array.isArray(plugin) ? plugin[0] : plugin;

async function main() {
  const platforms = ['android', 'ios'];
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms });
  const compiled = await compileModsAsync(exp, { projectRoot, platforms, introspect: true, ignoreExistingNativeFiles: true });
  const results = compiled._internal?.modResults;
  assert.ok(results?.android?.manifest?.manifest, 'Expo did not introspect the Android manifest');
  assert.ok(results?.ios?.infoPlist, 'Expo did not introspect the iOS Info.plist');
  const manifest = results.android.manifest.manifest;
  const permissions = manifest['uses-permission'] || [];
  for (const name of ['android.permission.RECORD_AUDIO', 'android.permission.FOREGROUND_SERVICE_MICROPHONE']) {
    const entries = permissions.filter(entry => entry.$?.['android:name'] === name);
    assert.equal(entries.length, 1, `${name} must have exactly one explicit removal rule`);
    assert.equal(entries[0].$['tools:node'], 'remove', `${name} must be blocked in the actual Expo manifest mod`);
  }
  for (const name of ['android.permission.CAMERA', 'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE', 'android.permission.SCHEDULE_EXACT_ALARM']) {
    assert.ok(permissions.some(entry => entry.$?.['android:name'] === name && entry.$?.['tools:node'] !== 'remove'), `${name} must remain available`);
  }
  const plist = results.ios.infoPlist;
  assert.equal(plist.NSMicrophoneUsageDescription, undefined);
  assert.equal(plist.NSSpeechRecognitionUsageDescription, undefined);
  assert.match(plist.NSCameraUsageDescription, /profile photo/);
  assert.match(plist.NSPhotoLibraryUsageDescription, /profile photo/);
  assert.equal(plist.NSSupportsLiveActivities, true, 'Timer Live Activity must remain enabled');
  assert.ok(!compiled.plugins.some(plugin => ['expo-speech-recognition', './plugins/withOfflineVoicePackaging'].includes(pluginName(plugin))));

  const notifications = compiled.plugins.find(plugin => pluginName(plugin) === 'expo-notifications');
  const sounds = notifications?.[1]?.sounds || [];
  assert.equal(sounds.length, 4, 'Existing Cantonese and English timer reminders must be retained');
  for (const sound of sounds) assert.ok(fs.existsSync(path.resolve(projectRoot, sound)), `Missing timer sound: ${sound}`);
  const timerManifest = read('modules/session-timer-notification/android/src/main/AndroidManifest.xml');
  for (const name of ['FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'FOREGROUND_SERVICE_SPECIAL_USE', 'WAKE_LOCK']) {
    assert.ok(timerManifest.includes(`android.permission.${name}`), `Timer permission ${name} must be retained`);
    assert.ok(!(compiled.android?.blockedPermissions || []).includes(`android.permission.${name}`), `Timer permission ${name} must not be blocked`);
  }

  const voiceRoot = 'modules/offline-assistant-voice/';
  const voiceManifest = read(`${voiceRoot}android/src/main/AndroidManifest.xml`);
  assert.ok(!voiceManifest.includes('RECORD_AUDIO'), 'Reply-only module must not request recording permission');
  assert.ok(voiceManifest.includes('android.intent.action.TTS_SERVICE'), 'Installed TTS service visibility must remain');
  const gradle = read(`${voiceRoot}android/build.gradle`);
  assert.doesNotMatch(gradle, /sherpa-onnx|verify-artifacts|vendor\/|\.aar/);
  assert.match(gradle, /sourceSets\.main\.assets\.setSrcDirs\(\[\]\)/);
  assert.match(gradle, /sourceSets\.main\.jniLibs\.setSrcDirs\(\[\]\)/);
  const podspec = read(`${voiceRoot}ios/OfflineAssistantVoice.podspec`);
  assert.doesNotMatch(podspec, /vendored_frameworks|OASenseVoiceEngine|\.onnx|sensevoice/);

  const exclusions = ignore().add(read('.easignore'));
  for (const file of ['vendor/android/sherpa-onnx.aar', 'vendor/ios/onnxruntime.xcframework/Info.plist',
    'assets/offline-assistant-voice/sensevoice/model.int8.onnx', 'assets/offline-assistant-voice/sensevoice/tokens.txt',
    'licenses/FunASR-MODEL_LICENSE', 'scripts/verify-artifacts.cjs', 'ios/OASenseVoiceEngine.h', 'ios/OASenseVoiceEngine.mm']) {
    assert.ok(exclusions.ignores(voiceRoot + file), `Retired ASR resource must be excluded from EAS: ${file}`);
  }
  for (const file of ['expo-module.config.json', 'package.json', 'android/build.gradle', 'android/src/main/AndroidManifest.xml',
    'android/src/main/java/expo/modules/offlineassistantvoice/OfflineAssistantVoiceModule.kt',
    'android/src/main/java/expo/modules/offlineassistantvoice/OfflineReplySpeaker.kt',
    'android/src/main/java/expo/modules/offlineassistantvoice/OfflineVoiceSelection.java',
    'ios/OfflineAssistantVoice.podspec', 'ios/OfflineAssistantVoiceModule.swift', 'ios/OfflineReplySpeaker.swift', 'ios/PrivacyInfo.xcprivacy']) {
    assert.ok(fs.existsSync(path.join(projectRoot, voiceRoot, file)), `Required reply playback file is missing: ${file}`);
    assert.ok(!exclusions.ignores(voiceRoot + file), `Required reply playback file is excluded from EAS: ${file}`);
  }
  for (const sound of sounds) assert.ok(!exclusions.ignores(sound.replace(/^\.\//, '')), `Timer sound excluded from EAS: ${sound}`);
  console.log(JSON.stringify({
    runtime: compiled.version, androidRecordingPermission: 'explicitly blocked by Expo manifest tools:node=remove',
    iosRecordingUsageDescriptions: 'absent', profilePhotos: 'retained', timerReminderSounds: sounds.length,
    timerMediaPlaybackPermissions: 'retained', easASRResources: 'excluded', easReplyPlaybackModule: 'retained',
    verification: 'read-only Expo plugin introspection and source/archive-rule checks; not a compiled APK/IPA',
  }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
