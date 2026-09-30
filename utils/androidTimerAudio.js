import { AppState } from 'react-native';
import { sessionTimerNotificationPlan } from './sessionTimerNotifications';
import { TIMER_AUDIO_SOUNDS } from './countdownAudioAssets';
import {
  isTimerAudioServiceAvailable, prepareNotificationChannelAsync,
  startTimerAudioServiceAsync, stopTimerAudioServiceAsync,
} from '../modules/session-timer-notification';

export { TIMER_AUDIO_SOUNDS } from './countdownAudioAssets';

/** The native service owns the clock card and cues together, including foreground audio. */
export function createAndroidTimerAudioManager({ retireLegacy = async () => {} } = {}) {
  let generation = 0;
  let queue = Promise.resolve();
  let retired = false;
  let startIntent = null;

  const serialize = (operation) => {
    const result = queue.then(operation).catch(() => ({ status: 'failed' }));
    queue = result;
    return result;
  };

  return {
    sync(input = {}) {
      if (!isTimerAudioServiceAvailable()) return Promise.resolve({ status: 'unavailable' });
      const snapshot = { ...input, session: input.session ? { ...input.session } : null };
      const initialPlan = sessionTimerNotificationPlan(snapshot);
      const identity = initialPlan.status === 'ready'
        ? JSON.stringify([input.ownerKey, initialPlan.payload.timerId, initialPlan.payload.startedAt]) : null;
      // Start/resume is a foreground-service intent, NOT a notification prompt.
      // Never transfer that intent to a new timer/account.
      if (!initialPlan.payload?.running || (startIntent && startIntent.identity !== identity)) startIntent = null;
      if (snapshot.allowStart && initialPlan.payload?.running) startIntent = { identity };
      const request = ++generation;
      const current = () => generation === request;
      return serialize(async () => {
        if (!current()) return { status: 'cancelled' };
        if (!retired) {
          // Cancels only this app's old timer/alarm IDs. Never touch chat pushes.
          await retireLegacy();
          retired = true;
        }
        if (!current()) return { status: 'cancelled' };
        let plan = sessionTimerNotificationPlan(snapshot);
        if (plan.status !== 'ready') {
          return stopTimerAudioServiceAsync({ preserveDue: snapshot.preserveDue === true || plan.status === 'expired' });
        }
        await prepareNotificationChannelAsync(plan.language === 'en' ? 'Current exercise timer' : '目前運動計時器');
        if (!current()) return { status: 'cancelled' };
        // Android permits a foreground media service without POST_NOTIFICATIONS.
        // Native code still supplies its required notification and reports its
        // actual visibility separately. Do not change the user's channel settings.
        plan = sessionTimerNotificationPlan(snapshot);
        // Asynchronous preparation must not shift either absolute milestone.
        if (plan.status !== 'ready') return stopTimerAudioServiceAsync({ preserveDue: plan.status === 'expired' });
        const { payload, language } = plan;
        const countdown = payload.recordMode === 'countdown' && payload.running;
        const halfwayAt = countdown ? payload.startedAt + (payload.targetDurationSec / 2 - payload.accumulatedSeconds) * 1000 : 0;
        const result = await startTimerAudioServiceAsync({
          ...payload,
          channelName: language === 'en' ? 'Current exercise timer' : '目前運動計時器',
          deadlineAt: countdown ? payload.startedAt + (payload.targetDurationSec - payload.accumulatedSeconds) * 1000 : 0,
          halfwayAt: !snapshot.session.countdownHalfwayAnnounced && halfwayAt > Date.now() ? halfwayAt : 0,
          halfwaySound: TIMER_AUDIO_SOUNDS[language].halfway,
          completeSound: TIMER_AUDIO_SOUNDS[language].complete,
          allowStart: startIntent?.identity === identity && AppState.currentState === 'active',
          restoreDismissed: snapshot.allowStart === true,
        });
        if (!current()) return { status: 'cancelled' };
        if (result.status === 'updated') startIntent = null;
        return result;
      });
    },
    clear({ preserveDue = false } = {}) {
      generation += 1;
      startIntent = null;
      if (!isTimerAudioServiceAvailable()) return Promise.resolve({ status: 'unavailable' });
      return serialize(() => stopTimerAudioServiceAsync({ preserveDue }));
    },
  };
}
