// Use the same packaged speech in foreground playback and native background
// notifications/services. No network request or installed phone voice is needed.
export const COUNTDOWN_MESSAGES = {
  zh: { halfway: '倒數計時已過一半。', complete: '倒數計時已結束。' },
  en: { halfway: 'The countdown is halfway complete.', complete: 'The countdown has finished.' },
};

export const TIMER_AUDIO_SOUNDS = {
  zh: { halfway: 'countdown_yue_halfway.wav', complete: 'countdown_yue_complete.wav' },
  en: { halfway: 'countdown_en_halfway.wav', complete: 'countdown_en_complete.wav' },
};

export const COUNTDOWN_SPEECH_ASSETS = {
  zh: {
    halfway: require('../assets/sounds/notifications/countdown_yue_halfway.wav'),
    complete: require('../assets/sounds/notifications/countdown_yue_complete.wav'),
  },
  en: {
    halfway: require('../assets/sounds/notifications/countdown_en_halfway.wav'),
    complete: require('../assets/sounds/notifications/countdown_en_complete.wav'),
  },
};
