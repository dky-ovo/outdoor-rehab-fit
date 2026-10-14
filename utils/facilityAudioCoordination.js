import * as Speech from 'expo-speech';

// Only facility text reading and recorded guidance share this owner. Timer cues
// and the assistant's native reader keep their independent lifecycles.
let owner = null;
let speechStop = Promise.resolve();

function stopSpeechInOrder() {
  // An earlier asynchronous stop must finish before a newer utterance starts.
  // Keep the queue usable after a native failure, but reject that caller's ready.
  const operation = speechStop.then(() => Speech.stop());
  speechStop = operation.catch(() => {});
  return operation;
}

export function claimFacilityAudio(kind, interrupt) {
  const previous = owner;
  if (previous) {
    owner = null;
    previous.active = false;
    previous.interrupt(); // Pause the existing recording now, without seeking.
  }
  const claim = {
    active: true,
    interrupt,
    isCurrent: () => owner === claim && claim.active,
    release() {
      claim.active = false;
      if (owner === claim) owner = null;
    },
    cancel() {
      if (!claim.isCurrent()) return Promise.resolve();
      claim.release();
      interrupt();
      // Cancelling an old/unmounted recording must not stop a newer TTS owner.
      return kind === 'speech' ? stopSpeechInOrder() : Promise.resolve();
    },
  };
  owner = claim;
  claim.ready = stopSpeechInOrder();
  return claim;
}
