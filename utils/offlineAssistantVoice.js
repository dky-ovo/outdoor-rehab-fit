// Native model assets are compiled into the new binary, never fetched here.
export function createOfflineVoiceAdapter(module) {
  if (!module) return { available: () => false, unavailableReason: () => 'missingNativeModule', nativeModulePresent: false, engine: 'offline' };
  const status = () => { try { return module.getStatus(); } catch { return {}; } };
  return {
    nativeModulePresent: true, engine: 'offline', preparationTimeoutMs: 120000, finalResultTimeoutMs: 90000,
    available: () => status().available === true && status().modelAvailable === true,
    unavailableReason: () => status().modelAvailable === false ? 'offlineModelUnavailable' : 'startFailed',
    servicePackage: () => 'sherpa-onnx / SenseVoice (on-device)',
    readDiagnostics: () => {
      let input = {}, reply = {};
      try { input = module.getDiagnostics?.() || {}; } catch { /* optional on earlier binaries */ }
      try { reply = module.getReplyStatus?.() || {}; } catch { /* optional on earlier binaries */ }
      // Explicit allowlist: never expose question text, tokens or audio paths.
      const value = {};
      for (const key of ['nativeRevision', 'lastStage', 'previousStage', 'lastExitReason', 'lastExitAt']) {
        if (typeof input[key] === 'string' || typeof input[key] === 'number') value[key] = input[key];
      }
      for (const key of ['requestedLanguage', 'selectedVoice', 'selectedLocale', 'defaultEngine', 'voiceConfirmed']) {
        if (['string', 'number', 'boolean'].includes(typeof reply[key])) value[key] = reply[key];
      }
      return value;
    },
    requestPermission: () => module.requestPermissionAsync(),
    addListener: (event, callback) => module.addListener(event, callback),
    start: options => module.startAsync({ lang: /^en/i.test(options.lang) ? 'en' : 'yue' }),
    stop: () => module.stopAsync(), abort: () => module.abortAsync(), ready: () => module.readyAsync(),
  };
}
