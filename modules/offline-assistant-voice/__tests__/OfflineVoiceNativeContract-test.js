const fs = require('node:fs');
const path = require('node:path');
const moduleRoot = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(moduleRoot, name), 'utf8');
const android = read('android/src/main/java/expo/modules/offlineassistantvoice/OfflineAssistantVoiceModule.kt');
const ios = read('ios/OfflineAssistantVoiceModule.swift');

describe('reply-only native integration contracts (not device playback tests)', () => {
  test('both platforms keep the reply module, methods and single event', () => {
    const config = JSON.parse(read('expo-module.config.json'));
    expect(config.platforms).toEqual(['android', 'apple']);
    for (const source of [android, ios]) {
      expect(source).toContain('Name("OfflineAssistantVoice")');
      expect(source).toContain('Events("onReplySpeech")');
      for (const api of ['speakReplyAsync', 'stopReplyAsync', 'getReplyStatus']) expect(source).toContain(`"${api}"`);
      expect(source).toContain('reply-only-20260921-r1');
    }
  });

  test('native entry points no longer expose or initialize voice input', () => {
    for (const source of [android, ios]) {
      for (const api of ['getStatus', 'getDiagnostics', 'requestPermissionAsync', 'startAsync', 'stopAsync', 'abortAsync', 'readyAsync']) {
        expect(source).not.toContain(`"${api}"`);
      }
      expect(source).not.toMatch(/AudioRecord|MediaRecorder|AVAudioEngine|AVAudioConverter|requestRecordPermission|RECORD_AUDIO|OfflineRecognizer|SenseVoice|sherpa|tokens\.txt|\.onnx|SpeechRecognizer|SFSpeechRecognizer/);
      expect(source).not.toMatch(/Events\("start"|sendEvent\("result"|"transcript"/);
    }
  });

  test('Android has no microphone permission, bundled model assets or native ASR dependencies', () => {
    const manifest = read('android/src/main/AndroidManifest.xml');
    const gradle = read('android/build.gradle');
    expect(manifest).not.toContain('RECORD_AUDIO');
    expect(manifest).toContain('android.intent.action.TTS_SERVICE');
    expect(gradle).toContain('sourceSets.main.assets.setSrcDirs([])');
    expect(gradle).toContain('sourceSets.main.jniLibs.setSrcDirs([])');
    expect(gradle).not.toMatch(/vendor|\.aar|classes\.jar|verify-artifacts|prepareSherpa|zipTree|noCompress|implementation files/);
  });

  test('iOS compiles only the two reply Swift files and has no ASR frameworks or resources', () => {
    const pod = read('ios/OfflineAssistantVoice.podspec');
    expect(pod).toContain("s.source_files = 'OfflineAssistantVoiceModule.swift', 'OfflineReplySpeaker.swift'");
    expect(pod).toContain("s.dependency 'ExpoModulesCore'");
    expect(pod).not.toMatch(/vendored_frameworks|\.xcframework|OASenseVoice|\.mm|\.h['"]|\.onnx|\.\.\/assets|\.\.\/vendor|verify-artifacts|script_phase/);
    expect(pod).toContain('PrivacyInfo.xcprivacy');
  });

  test('background and disposal stop speech; foreground does not restart old answers', () => {
    expect(android).toContain('OnActivityEntersBackground { foreground = false; onMain { speaker?.stop() } }');
    expect(android).toContain('destroyed = true');
    expect(android).toContain('speaker?.dispose()');
    expect(ios).toContain('self.foreground = false; self.speaker?.stop()');
    expect(ios).toContain('self.speaker?.dispose()');
    expect(android).not.toMatch(/OnActivityEntersForeground[^\n]*\.speak/);
    expect(ios).not.toMatch(/OnAppEntersForeground[^\n]*\.speak/);
  });

  test('reply start and stop remain on main and status does not create a speech engine', () => {
    for (const method of ['speakReplyAsync', 'stopReplyAsync']) {
      expect(android).toMatch(new RegExp(`AsyncFunction\\("${method}"\\)[\\s\\S]*?runOnQueue\\(Queues.MAIN\\)`));
      expect(ios).toMatch(new RegExp(`AsyncFunction\\("${method}"\\)[\\s\\S]*?runOnQueue\\(\\.main\\)`));
    }
    const androidStatus = android.slice(android.indexOf('Function("getReplyStatus")'), android.indexOf('OnActivityEntersForeground'));
    const iosStatus = ios.slice(ios.indexOf('Function("getReplyStatus")'), ios.indexOf('OnAppEntersForeground'));
    expect(androidStatus).not.toContain('replySpeaker()');
    expect(iosStatus).not.toContain('replySpeaker()');
  });

  test('native transport discards post-disposal events and has no audio/transcript storage or network', () => {
    expect(android).toContain('if (destroyed) return@post');
    expect(ios).toContain('guard !self.destroyed else { return }');
    for (const source of [android, ios]) {
      expect(source).not.toMatch(/FileOutputStream|URLSession|HttpURLConnection|SharedPreferences|UserDefaults|Log\.[diwe]\(|print\(|println\(/);
    }
  });

  test('module metadata describes answer playback, not microphone recognition', () => {
    const config = JSON.parse(read('package.json'));
    expect(config.name).toBe('offline-assistant-voice');
    expect(config.version).toBe('1.1.0');
    expect(config.description).toContain('answer playback; no voice input');
    expect(read('index.js')).toContain("requireOptionalNativeModule('OfflineAssistantVoice')");
  });
});
