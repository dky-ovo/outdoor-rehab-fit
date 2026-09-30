// Keep the existing Android/iOS publishing scripts' project selection intact.
// This additive config is not overwritten when those scripts restore app.json.
module.exports = ({ config }) => {
  const timerPlugin = './plugins/withSessionTimerLiveActivity';
  const cropPlugin = './plugins/withImagePickerContrast';
  const voicePackagingPlugin = './plugins/withOfflineVoicePackaging';
  const cameraPermission = 'Use the camera to take your profile photo.';
  const photosPermission = 'Choose your profile photo from your photo library.';
  const reminderSounds = [
    './assets/sounds/notifications/countdown_en_halfway.wav',
    './assets/sounds/notifications/countdown_en_complete.wav',
    './assets/sounds/notifications/countdown_yue_halfway.wav',
    './assets/sounds/notifications/countdown_yue_complete.wav',
  ];
  const pluginName = (plugin) => Array.isArray(plugin) ? plugin[0] : plugin;
  let plugins = (config.plugins || []).filter(plugin => !['expo-speech-recognition', voicePackagingPlugin].includes(pluginName(plugin))).map((plugin) => {
    const options = Array.isArray(plugin) ? plugin[1] || {} : {};
    if (pluginName(plugin) === 'expo-image-picker') return ['expo-image-picker', { ...options, cameraPermission, photosPermission, microphonePermission: false }];
    if (pluginName(plugin) === 'expo-audio') return ['expo-audio', { ...options, microphonePermission: false, recordAudioAndroid: false, enableBackgroundRecording: false }];
    if (pluginName(plugin) !== 'expo-notifications') return plugin;
    return ['expo-notifications', { ...options, sounds: [...new Set([...(options.sounds || []), ...reminderSounds])] }];
  });
  if (!plugins.some((plugin) => pluginName(plugin) === 'expo-notifications')) {
    plugins = [...plugins, ['expo-notifications', { sounds: reminderSounds }]];
  }
  if (!plugins.some((plugin) => pluginName(plugin) === cropPlugin)) plugins.push(cropPlugin);
  const infoPlist = { ...config.ios?.infoPlist };
  delete infoPlist.NSSpeechRecognitionUsageDescription;
  delete infoPlist.NSMicrophoneUsageDescription;
  const parts = String(config.version || '0.0.0').split('.').map(Number);
  // Android publishing scripts select this project before Expo resolves config.
  // Isolate the startup-compatibility APK from existing 1.2.2 OTA bundles while
  // leaving the separate iOS project's current version/runtime unchanged.
  const androidStartupRelease = config.extra?.eas?.projectId === 'bcee8c37-e833-4f4d-b660-aa457accd96d';
  const minimumPatch = androidStartupRelease ? 3 : 2;
  const needsCurrentRuntime = !Number.isFinite(parts[0]) || parts[0] < 1 || parts[0] === 1 && ((parts[1] || 0) < 2 || parts[1] === 2 && (parts[2] || 0) < minimumPatch);
  const recordingPermissions = ['RECORD_AUDIO', 'FOREGROUND_SERVICE_MICROPHONE', 'android.permission.RECORD_AUDIO', 'android.permission.FOREGROUND_SERVICE_MICROPHONE'];
  return {
    ...config,
    // Native voice input APIs/assets have been retired; only reply playback remains.
    // Keep older UI bundles that call recording APIs away from this new binary.
    version: needsCurrentRuntime ? `1.2.${minimumPatch}` : config.version,
    ios: { ...config.ios, infoPlist: { ...infoPlist,
      NSCameraUsageDescription: cameraPermission, NSPhotoLibraryUsageDescription: photosPermission } },
    android: { ...config.android, permissions: [...new Set([...(config.android?.permissions || []).filter(permission => !recordingPermissions.includes(permission)),
      'android.permission.SCHEDULE_EXACT_ALARM'])],
      blockedPermissions: [...new Set([...(config.android?.blockedPermissions || []),
        'android.permission.RECORD_AUDIO', 'android.permission.FOREGROUND_SERVICE_MICROPHONE'])] },
    plugins: plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === timerPlugin)
      ? plugins : [...plugins, timerPlugin],
  };
};
