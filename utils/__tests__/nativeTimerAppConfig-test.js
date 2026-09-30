const configure = require('../../app.config');

test.each([
  ['dky2004', 'bcee8c37-e833-4f4d-b660-aa457accd96d'],
  ['maxcch.c', '1d1f05e7-ef12-456a-9c53-31bce530f5b3'],
])('lock screen config preserves %s publishing project', (owner, projectId) => {
  const config = { version: '1.1.1', owner, extra: { eas: { projectId } }, updates: { url: `https://u.expo.dev/${projectId}` }, plugins: ['expo-router'], runtimeVersion: { policy: 'appVersion' } };
  const result = configure({ config });
  expect(result).toMatchObject({ ...config, version: owner === 'dky2004' ? '1.2.3' : '1.2.2', plugins: expect.arrayContaining([
    'expo-router', './plugins/withSessionTimerLiveActivity', './plugins/withImagePickerContrast',
  ]) });
  expect(result.android.permissions).toContain('android.permission.SCHEDULE_EXACT_ALARM');
  expect(result.android.permissions).not.toContain('android.permission.USE_EXACT_ALARM');
  expect(config.version).toBe('1.1.1');
  expect(config.plugins).toEqual(['expo-router']);
});

test.each(['1.1.1', '1.1.9', '1.2.0', '1.2.1', '1.2.2'])('Android startup build %s cannot load older 1.2.2 updates', version => {
  const result = configure({ config: { version, extra: { eas: { projectId: 'bcee8c37-e833-4f4d-b660-aa457accd96d' } }, runtimeVersion: { policy: 'appVersion' }, plugins: [] } });
  expect(result.version).toBe('1.2.3');
  expect(result.runtimeVersion).toEqual({ policy: 'appVersion' });
  expect(configure({ config: result })).toEqual(result);
});

test.each(['1.2.3', '1.2.10', '2.0.0'])('Android startup version does not downgrade a newer %s', version => {
  const result = configure({ config: { version, extra: { eas: { projectId: 'bcee8c37-e833-4f4d-b660-aa457accd96d' } }, plugins: [] } });
  expect(result.version).toBe(version);
});

test('notification audio paths exist and existing notification and Android options are preserved', () => {
  const fs = require('fs');
  const path = require('path');
  const result = configure({ config: { version: '1.1.2', android: { package: 'unchanged', permissions: ['android.permission.CAMERA'] },
    plugins: [['expo-notifications', { color: '#A5001E', defaultChannel: 'chat-messages' }]] } });
  const options = result.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications')[1];
  expect(options).toMatchObject({ color: '#A5001E', defaultChannel: 'chat-messages' });
  expect(options.sounds).toHaveLength(4);
  expect(options.sounds).toEqual(expect.arrayContaining([
    './assets/sounds/notifications/countdown_yue_halfway.wav', './assets/sounds/notifications/countdown_yue_complete.wav',
  ]));
  expect(options.sounds.some((sound) => sound.includes('chime'))).toBe(false);
  for (const sound of options.sounds) {
    const wav = fs.readFileSync(path.resolve(__dirname, '../..', sound));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
  }
  expect(result.android.package).toBe('unchanged');
  expect(result.android.permissions).toContain('android.permission.CAMERA');
  expect(result.version).toBe('1.2.2');
});

test.each(['1.1.1', '1.1.2', '1.1.3', '1.1.4', '1.1.5', '1.1.6', '1.1.7', '1.1.8', '1.1.9', '1.2.0', '1.2.1'])('%s gets a new runtime for reply-only speech without recording APIs', (version) => {
  expect(configure({ config: { version, plugins: [] } }).version).toBe('1.2.2');
});

test.each(['1.2.2', '1.2.3', '2.0.0'])('registration is idempotent and app version %s is preserved', (version) => {
  const once = configure({ config: { version, plugins: [] } });
  expect(configure({ config: once })).toEqual(once);
  expect(once.version).toBe(version);
});

test('reply-only playback blocks recording permission and keeps profile photos supported', () => {
  const source = require('../../app.json').expo;
  const result = configure({ config: source });
  const plugins = new Map(result.plugins.filter(Array.isArray));
  expect(plugins.has('expo-speech-recognition')).toBe(false);
  expect(plugins.get('expo-audio')).toMatchObject({ recordAudioAndroid: false, enableBackgroundPlayback: false });
  expect(plugins.get('expo-audio')).toMatchObject({ microphonePermission: false, enableBackgroundRecording: false });
  expect(plugins.get('expo-image-picker').microphonePermission).toBe(false);
  expect(result.ios.infoPlist.NSMicrophoneUsageDescription).toBeUndefined();
  expect(result.ios.infoPlist.NSSpeechRecognitionUsageDescription).toBeUndefined();
  expect(result.android.permissions).not.toContain('android.permission.RECORD_AUDIO');
  expect(result.android.blockedPermissions).toEqual(expect.arrayContaining(['android.permission.RECORD_AUDIO', 'android.permission.FOREGROUND_SERVICE_MICROPHONE']));
  expect(result.ios.infoPlist.NSCameraUsageDescription).toBe('Use the camera to take your profile photo.');
  expect(plugins.get('expo-image-picker').photosPermission).not.toContain('facility');
});

test('migrating old speech configuration removes cloud/system recognition plugin and iOS permission without dropping unrelated settings', () => {
  const result = configure({ config: {
    version: '1.1.9', plugins: ['expo-router', ['expo-speech-recognition', { microphonePermission: 'old' }], './plugins/withOfflineVoicePackaging'],
    android: { permissions: ['RECORD_AUDIO', 'android.permission.RECORD_AUDIO', 'android.permission.CAMERA'], blockedPermissions: ['android.permission.READ_CONTACTS'] },
    ios: { bundleIdentifier: 'com.example.keep', infoPlist: { NSSpeechRecognitionUsageDescription: 'old system speech', NSMicrophoneUsageDescription: 'old mic', NSFaceIDUsageDescription: 'unchanged' } },
  } });
  expect(result.plugins.map(plugin => Array.isArray(plugin) ? plugin[0] : plugin)).not.toContain('expo-speech-recognition');
  expect(result.ios.infoPlist.NSSpeechRecognitionUsageDescription).toBeUndefined();
  expect(result.ios.bundleIdentifier).toBe('com.example.keep');
  expect(result.ios.infoPlist.NSFaceIDUsageDescription).toBe('unchanged');
  expect(result.version).toBe('1.2.2');
  expect(result.plugins).not.toContain('./plugins/withOfflineVoicePackaging');
  expect(result.ios.infoPlist.NSMicrophoneUsageDescription).toBeUndefined();
  expect(result.android.permissions).not.toEqual(expect.arrayContaining(['RECORD_AUDIO', 'android.permission.RECORD_AUDIO']));
  expect(result.android.permissions).toContain('android.permission.CAMERA');
  expect(result.android.blockedPermissions).toContain('android.permission.READ_CONTACTS');
});
