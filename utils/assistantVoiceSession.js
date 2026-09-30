// Native speech uses bundled models; Web uses the browser's own recognizer.
// Callers decide when to send confirmed text to the AI. No native audio upload.
export const VOICE_SESSION_LIMIT_MS = 60000;
export const VOICE_FINAL_RESULT_LIMIT_MS = 6000;

export function voiceRecognitionLanguage(locale, platform) {
  return /^en/i.test(String(locale)) ? 'en-US' : platform === 'android' ? 'yue-Hant-HK' : 'zh-HK';
}

export function voiceErrorCode(error) {
  const code = typeof error === 'string' ? error : error?.error || error?.code;
  if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code)) return 'permissionDenied';
  if (['language-not-supported', 'language-unavailable'].includes(code)) return 'languageUnavailable';
  if (code === 'unavailable') return 'speechServiceUnavailable';
  if (['offlineModelUnavailable', 'model-unavailable'].includes(code)) return 'offlineModelUnavailable';
  if (['microphone-memory', 'model-memory'].includes(code)) return 'voiceMemoryUnavailable';
  if (['no-speech', 'speech-timeout', 'nomatch'].includes(code)) return 'noSpeech';
  if (code === 'network') return 'networkError';
  if (code === 'timeout') return 'timeout';
  return 'startFailed';
}

export function createAssistantVoiceSession({ adapter, language, onState, onTranscript, onRelease = () => {} }) {
  let generation = 0;
  let status = 'idle';
  let subscriptions = [];
  let timers = [];
  let delivered = false;
  let disposed = false;
  let acquired = false;
  let cleanup = Promise.resolve();
  const publish = (next, interimText = '', errorCode = null) => {
    status = next;
    if (!disposed) onState({ status: next, interimText, errorCode });
  };
  const clear = () => {
    subscriptions.forEach((subscription) => subscription?.remove?.());
    subscriptions = [];
    timers.forEach(clearTimeout);
    timers = [];
  };
  const finish = (errorCode = null) => {
    ++generation;
    clear();
    if (acquired) {
      acquired = false;
      // Wait for the old recognizer to release its audio session before allowing
      // a subsequent attempt or restoring playback mode.
      cleanup = Promise.resolve().then(() => adapter.abort()).catch(() => {}).then(() => adapter.ready?.()).catch(() => {})
        .then(() => onRelease()).catch(() => {});
    }
    publish('idle', '', errorCode);
  };
  const arm = (callback, delay) => { timers.push(setTimeout(callback, delay)); };
  const cancel = async () => { finish(); await cleanup; };
  const stop = async () => {
    if (status === 'requesting') return cancel();
    if (status !== 'listening') return;
    const current = generation;
    publish('processing');
    // Arm before awaiting native stop: offline decoding can take longer than a
    // system recognizer, but a hung native promise still needs a deadline.
    arm(() => { if (current === generation) finish(delivered ? null : 'timeout'); }, adapter.finalResultTimeoutMs || VOICE_FINAL_RESULT_LIMIT_MS);
    try { await adapter.stop(); } catch { if (current === generation) finish('startFailed'); return; }
  };
  const start = async () => {
    if (disposed || status !== 'idle') return false;
    if (!adapter?.available()) { publish('idle', '', adapter?.unavailableReason?.() || 'speechServiceUnavailable'); return false; }
    const current = ++generation;
    const valid = () => !disposed && current === generation;
    delivered = false;
    publish('requesting');
    // A dismissed/stuck OS prompt must not leave the app permanently busy.
    arm(() => finish('timeout'), adapter.preparationTimeoutMs || 30000);
    try {
      await cleanup;
      if (!valid()) return false;
      const permission = await adapter.requestPermission();
      if (!valid()) return false;
      if (!permission) { finish('permissionDenied'); return false; }
      await adapter.ready?.();
      if (!valid()) return false;
      clear();
      acquired = true;
      const listen = (event, callback) => {
        subscriptions.push(adapter.addListener(event, (value) => { if (valid()) callback(value); }));
      };
      listen('start', () => { if (status !== 'processing') publish('listening'); });
      listen('result', (event) => {
        const transcript = event?.results?.[0]?.transcript;
        if (typeof transcript !== 'string' || !transcript.trim() || delivered) return;
        // Bound data from external platform engines, without persisting it.
        const text = transcript.trim().slice(0, 4000);
        if (!event.isFinal) { publish(status, text); return; }
        delivered = true;
        publish('processing');
        onTranscript(text);
        if (valid()) arm(() => finish(), VOICE_FINAL_RESULT_LIMIT_MS);
      });
      listen('error', (error) => finish(delivered || error?.error === 'aborted' ? null : voiceErrorCode(error)));
      listen('nomatch', () => finish(delivered ? null : 'noSpeech'));
      listen('end', () => finish(delivered ? null : 'noSpeech'));
      await adapter.start({ lang: language, interimResults: true, continuous: false, maxAlternatives: 1,
        recordingOptions: { persist: false } });
      if (!valid()) return false;
      // Some recognizers do not emit `start`; show a usable stop control anyway.
      if (status === 'requesting') publish('listening');
      arm(() => { void stop(); }, VOICE_SESSION_LIMIT_MS);
      return true;
    } catch (error) {
      if (valid()) finish(voiceErrorCode(error));
      return false;
    }
  };
  return { start, stop, cancel, dispose: () => { disposed = true; return cancel(); } };
}

export function createBrowserVoiceAdapter(Recognition) {
  let recognition;
  const handlers = new Map();
  const emit = (name, value) => handlers.get(name)?.forEach((fn) => fn(value));
  return {
    available: () => typeof Recognition === 'function',
    unavailableReason: () => 'browserUnavailable',
    requestPermission: async () => true, // start() triggers the browser permission prompt.
    addListener(name, callback) {
      if (!handlers.has(name)) handlers.set(name, new Set());
      handlers.get(name).add(callback);
      return { remove: () => handlers.get(name)?.delete(callback) };
    },
    start(options) {
      recognition = new Recognition();
      const instance = recognition;
      instance.lang = options.lang;
      instance.interimResults = true;
      instance.continuous = false;
      instance.maxAlternatives = 1;
      for (const event of ['start', 'end', 'error', 'nomatch']) {
        instance['on' + event] = (value) => { if (recognition === instance) emit(event, value); };
      }
      instance.onresult = (event) => {
        if (recognition !== instance) return;
        const result = event.results?.[event.resultIndex];
        if (result) emit('result', { isFinal: result.isFinal, results: [{ transcript: result[0]?.transcript }] });
      };
      instance.start();
    },
    stop: () => recognition?.stop(),
    abort() { const instance = recognition; recognition = null; instance?.abort(); },
  };
}
