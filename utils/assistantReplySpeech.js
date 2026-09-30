import { isAssistantMicrophoneActive, registerAssistantReader, stopAssistantReaders } from './assistantAudioCoordination';

let serial = 0;
export function replySpeechChunks(text) {
  if (typeof text !== 'string') return [];
  const plain = text.slice(0, 16000).replace(/[\uD800-\uDBFF]$/, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim();
  const chunks = [];
  let current = '';
  for (const character of Array.from(plain)) {
    if (current.length + character.length > 1800) { chunks.push(current); current = ''; }
    current += character;
    if (current.length >= 400 && /[。！？.!?\n]/.test(character)) { chunks.push(current); current = ''; }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function createAssistantReplyReader({ native, language, onState }) {
  let generation = 0, disposed = false, utterance = null, messageId = null, chunks = [], index = 0, timer;
  let cleanup = Promise.resolve();
  const publish = (status, errorCode = null) => {
    if (!disposed) onState({ status, activeMessageId: status === 'idle' ? null : messageId, errorCode });
  };
  const stop = () => {
    ++generation; utterance = null; chunks = []; clearTimeout(timer);
    // Issue native cancellation immediately. A deferred old cleanup must never
    // stop the next reader after a screen/language change.
    try { cleanup = Promise.resolve(native?.stopReplyAsync?.()).catch(() => {}); } catch { cleanup = Promise.resolve(); }
    publish('idle');
    return cleanup;
  };
  const fail = errorCode => { void stop(); publish('idle', errorCode); };
  const launch = async current => {
    if (disposed || current !== generation || isAssistantMicrophoneActive()) return;
    if (index >= chunks.length) { utterance = null; publish('idle'); return; }
    utterance = `reply-${++serial}-${index}`;
    const id = utterance;
    publish('loading');
    timer = setTimeout(() => { if (current === generation && id === utterance) fail('playbackFailed'); }, 180000);
    try { await native.speakReplyAsync(id, chunks[index], language); }
    catch (error) { if (current === generation && id === utterance) fail(error?.code === 'voiceUnavailable' ? 'voiceUnavailable' : 'playbackFailed'); }
  };
  const subscription = native?.addListener?.('onReplySpeech', event => {
    if (disposed || !utterance || event?.id !== utterance) return;
    if (event.errorCode === 'interrupted') { void stop(); return; }
    if (event.errorCode) { fail(['voiceUnavailable', 'missingNativeModule'].includes(event.errorCode) ? event.errorCode : 'playbackFailed'); return; }
    if (event.status === 'loading' || event.status === 'speaking') publish(event.status);
    if (event.status === 'idle') {
      clearTimeout(timer); utterance = null; index++;
      void launch(generation);
    }
  });
  const unregister = registerAssistantReader(stop);
  return {
    async read(id, text) {
      const parts = replySpeechChunks(text);
      if (disposed || isAssistantMicrophoneActive() || !parts.length) return false;
      const pendingStop = stop();
      const current = generation;
      await pendingStop;
      if (disposed || current !== generation || isAssistantMicrophoneActive()) return false;
      await stopAssistantReaders(stop);
      if (disposed || current !== generation || isAssistantMicrophoneActive()) return false;
      if (!native?.speakReplyAsync || !subscription) { publish('idle', 'missingNativeModule'); return false; }
      messageId = id; chunks = parts; index = 0;
      void launch(current);
      return true;
    },
    stop,
    dispose() { disposed = true; unregister(); subscription?.remove?.(); return stop(); },
  };
}
