import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Existing OTA installations do not contain this module. Never require it
// unconditionally: those installations must remain usable until the next Build.
const nativeModule = ['android', 'ios'].includes(Platform.OS)
  ? requireOptionalNativeModule('SessionTimerNotification')
  : null;

export function isSessionTimerNotificationAvailable() {
  return Boolean(nativeModule?.updateAsync && nativeModule?.clearAsync);
}

export async function updateAsync(options) {
  if (!isSessionTimerNotificationAvailable()) return { status: 'unavailable' };
  if (!options || typeof options !== 'object' || Array.isArray(options)) return { status: 'invalid' };
  return nativeModule.updateAsync({ ...options, startedAt: options.startedAt ?? 0 });
}

export async function clearAsync() {
  if (!isSessionTimerNotificationAvailable()) return { status: 'unavailable' };
  return nativeModule.clearAsync();
}

// Read-only revalidation, optional for binaries built before the lock-screen UI.
export async function getStatusAsync() {
  if (typeof nativeModule?.getStatusAsync !== 'function') return { status: 'unavailable' };
  return nativeModule.getStatusAsync();
}

export async function prepareNotificationChannelAsync(channelName) {
  if (Platform.OS !== 'android' || typeof nativeModule?.prepareNotificationChannelAsync !== 'function') return { status: 'unavailable' };
  return nativeModule.prepareNotificationChannelAsync(channelName);
}

export async function checkReminderSettingsAsync() {
  if (Platform.OS !== 'android' || typeof nativeModule?.checkReminderSettingsAsync !== 'function') return { status: 'unavailable' };
  return nativeModule.checkReminderSettingsAsync();
}

export async function openExactAlarmSettingsAsync() {
  if (Platform.OS !== 'android' || typeof nativeModule?.openExactAlarmSettingsAsync !== 'function') return { status: 'unavailable' };
  return nativeModule.openExactAlarmSettingsAsync();
}

export async function openNotificationSettingsAsync() {
  if (Platform.OS !== 'android' || typeof nativeModule?.openNotificationSettingsAsync !== 'function') return { status: 'unavailable' };
  return nativeModule.openNotificationSettingsAsync();
}

// Runtime 1.1.4+: countdown alarms are delivered entirely by Android, without
// waking React Native to decide whether a notification should play its sound.
export function isNativeCountdownReminderAvailable() {
  return Platform.OS === 'android' && typeof nativeModule?.scheduleCountdownRemindersAsync === 'function'
    && typeof nativeModule?.clearCountdownRemindersAsync === 'function';
}

export async function scheduleCountdownRemindersAsync(options) {
  if (!isNativeCountdownReminderAvailable()) return { status: 'unavailable' };
  return nativeModule.scheduleCountdownRemindersAsync(options);
}

export async function clearCountdownRemindersAsync(options = {}) {
  if (!isNativeCountdownReminderAvailable()) return { status: 'unavailable' };
  return nativeModule.clearCountdownRemindersAsync(options.preserveDue === true, options.expiredOnly === true);
}

// Runtime 1.1.5+: one Android foreground service owns both the visible clock
// and actual app audio. Old Android binaries and iOS keep their existing path.
export function isTimerAudioServiceAvailable() {
  return Platform.OS === 'android' && typeof nativeModule?.startTimerAudioServiceAsync === 'function'
    && typeof nativeModule?.stopTimerAudioServiceAsync === 'function'
    && typeof nativeModule?.getTimerAudioServiceStatusAsync === 'function';
}

export async function startTimerAudioServiceAsync(options) {
  if (!isTimerAudioServiceAvailable()) return { status: 'unavailable' };
  if (!options || typeof options !== 'object' || Array.isArray(options)) return { status: 'invalid' };
  return nativeModule.startTimerAudioServiceAsync({ ...options, startedAt: options.startedAt ?? 0 });
}

export async function stopTimerAudioServiceAsync({ preserveDue = false } = {}) {
  if (!isTimerAudioServiceAvailable()) return { status: 'unavailable' };
  return nativeModule.stopTimerAudioServiceAsync(preserveDue === true);
}

export async function getTimerAudioServiceStatusAsync() {
  if (!isTimerAudioServiceAvailable()) return { status: 'unavailable' };
  return nativeModule.getTimerAudioServiceStatusAsync();
}
