const fs = require('node:fs');
const path = require('node:path');

// Source contracts only: these assertions do not substitute for native compilation or phone tests.
const root = path.resolve(__dirname, '..');
const android = fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/offlineassistantvoice/OfflineReplySpeaker.kt'), 'utf8');
const selectionPolicy = fs.readFileSync(path.join(root, 'android/src/main/java/expo/modules/offlineassistantvoice/OfflineVoiceSelection.java'), 'utf8');
const ios = fs.readFileSync(path.join(root, 'ios/OfflineReplySpeaker.swift'), 'utf8');

test('Android reply speech excludes network and uninstalled voices before language matching', () => {
  const selection = android.slice(android.indexOf('private fun eligible'), android.indexOf('private fun speakPending'));
  expect(selection).toContain('voice.isNetworkConnectionRequired');
  expect(selection).toContain('voice.features?.contains("notInstalled") == true');
  expect(selection).toContain('OfflineVoiceSelection.eligible');
  expect(selection).toContain('OfflineVoiceSelection.confirmsSelection');
  expect(selection).toContain('val actual = tts.voice ?: return null');
  expect(selectionPolicy).toContain('CANTONESE_ID.matcher(id).find()');
  expect(selectionPolicy).toContain('MANDARIN_ID.matcher(id).find()');
  expect(selectionPolicy).toContain('wantedName.equals(actualName)');
  expect(android).not.toMatch(/setLanguage\(|Locale\.(CHINESE|CHINA|TAIWAN)/);
});

test('iOS reply speech uses enumerated voices and never substitutes Mandarin', () => {
  expect(ios).toContain('AVSpeechSynthesisVoice.speechVoices().filter');
  const selection = ios.slice(ios.indexOf('private func eligible'), ios.indexOf('private func armTimeout'));
  expect(selection).toContain('if candidate == "yue" || candidate.hasPrefix("yue-") { return 2 }');
  expect(selection).toContain('candidate == "zh-hk" || candidate == "zh-hant-hk" ? 1 : 0');
  expect(selection).toContain('requested.hasPrefix("en-")');
  expect(ios).toContain('effective.identifier == voice.identifier');
  expect(ios).toContain('effective.language == voice.language');
  expect(selection).not.toContain('zh-cn');
  expect(ios).not.toMatch(/(?:let|var)\s+\w+\s*=\s*AVSpeechSynthesisVoice\(language:/);
});

test('selection diagnostics contain only engine and voice metadata, not spoken answers', () => {
  for (const source of [android, ios]) {
    expect(source).toContain('"requestedLanguage"');
    expect(source).toContain('"selectedVoice"');
    expect(source).toContain('"selectedLocale"');
    expect(source).toContain('"voiceConfirmed"');
    expect(source).toContain('"defaultEngine"');
    const emit = source.slice(source.indexOf('private fun emit') >= 0 ? source.indexOf('private fun emit') : source.indexOf('private func emit'));
    expect(emit).not.toMatch(/put\("text"|\["text"\]|request\.text/);
  }
});

test('both native implementations publish recoverable unavailable and playback statuses without retaining text', () => {
  for (const source of [android, ios]) {
    for (const value of ['"loading"', '"speaking"', '"idle"', '"voiceUnavailable"', '"playbackFailed"', '"inputTooLong"']) {
      expect(source).toContain(value);
    }
    expect(source).not.toMatch(/https?:\/\/|URLSession|HttpURLConnection|FileOutputStream|UserDefaults|SharedPreferences|Log\.|print\(/);
  }
  expect(android).toContain('text.length > 3500');
  expect(ios).toContain('text.utf16.count <= 3500');
});

test('Android cancels pending initialization text and rejects stale engine and utterance callbacks', () => {
  expect(android).toContain('generation != engineGeneration');
  expect(android).toContain('val request = pending ?: return');
  expect(android).toContain('id == utteranceId && activeId != null');
  const finish = android.slice(android.indexOf('private fun finish'), android.indexOf('private fun emit'));
  expect(finish).toContain('activeId = null');
  expect(finish).toContain('pending = null');
  expect(finish).toContain('utteranceId = null');
  expect(finish.indexOf('utteranceId = null')).toBeLessThan(finish.indexOf('engine?.stop()'));
  expect(android).toContain('main.postDelayed(timeout, 10000L)');
  expect(android).toContain('armPlaybackTimeout(token, 15000L)');
});

test('audio interruption is terminal so JS cannot mistake cancellation for completed speech', () => {
  expect(android).toContain('AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK');
  expect(android).toContain('main.post { finish("interrupted") }');
  expect(ios).toContain('UIApplication.didEnterBackgroundNotification');
  expect(ios).toContain('AVAudioSession.interruptionNotification');
  expect(ios).toContain('self?.finish(errorCode: "interrupted")');
  expect(ios).toContain('activeUtterance === utterance');
  const finish = ios.slice(ios.indexOf('private func finish'), ios.indexOf('private func emit'));
  expect(finish.indexOf('activeUtterance = nil')).toBeLessThan(finish.indexOf('synthesizer.stopSpeaking'));
});

test('voice playback is bounded and disposal invalidates work instead of resuming automatically', () => {
  expect(android).toContain('disposed = true');
  expect(android).toContain('engine?.shutdown()');
  expect(android).toContain('armPlaybackTimeout(id, 420000L)');
  expect(ios).toContain('self.disposed = true');
  expect(ios).toContain('self.synthesizer.delegate = nil');
  expect(ios).toContain('armTimeout(utterance, seconds: 420)');
  expect(ios).toContain('if ownsAudioSession');
  expect(ios).toContain('setActive(false, options: .notifyOthersOnDeactivation)');
  for (const source of [android, ios]) expect(source).not.toMatch(/continueSpeaking|AUDIOFOCUS_GAIN\s*->/);
});
