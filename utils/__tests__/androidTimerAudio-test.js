import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Native from '../../modules/session-timer-notification';
import { createAndroidTimerAudioManager, TIMER_AUDIO_SOUNDS } from '../androidTimerAudio';

jest.mock('react-native', () => ({ AppState: { currentState: 'active' }, Platform: { OS: 'android' } }));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), getNotificationChannelAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(), AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));
jest.mock('../../modules/session-timer-notification', () => ({
  isTimerAudioServiceAvailable: jest.fn(), prepareNotificationChannelAsync: jest.fn(),
  startTimerAudioServiceAsync: jest.fn(), stopTimerAudioServiceAsync: jest.fn(),
}));

const NOW = Date.parse('2026-09-09T12:00:00Z');
const input = (overrides = {}) => ({ ownerKey: 'user:one', locale: 'zh', allowStart: true,
  session: { timerId: 'timer-one', countdownId: 'timer-one', started: true, running: true,
    recordMode: 'countdown', startedAt: NOW, accumulatedSeconds: 0, targetDurationSec: 120 }, ...overrides });
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
let retireLegacy;
let manager;

beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); jest.clearAllMocks();
  AppState.currentState = 'active';
  Native.isTimerAudioServiceAvailable.mockReturnValue(true);
  Native.prepareNotificationChannelAsync.mockResolvedValue({ status: 'prepared' });
  Native.startTimerAudioServiceAsync.mockResolvedValue({ status: 'updated', audioOwned: true });
  Native.stopTimerAudioServiceAsync.mockResolvedValue({ status: 'cleared' });
  Notifications.getPermissionsAsync.mockResolvedValue({ granted: true });
  Notifications.getNotificationChannelAsync.mockResolvedValue({ sound: 'default' });
  Notifications.requestPermissionsAsync.mockResolvedValue({ granted: true });
  retireLegacy = jest.fn(async () => {});
  manager = createAndroidTimerAudioManager({ retireLegacy });
});
afterEach(() => jest.useRealTimers());

test('starts native audio with the existing clock card and immutable absolute milestones', async () => {
  await expect(manager.sync(input())).resolves.toMatchObject({ status: 'updated', audioOwned: true });
  expect(Native.startTimerAudioServiceAsync).toHaveBeenCalledWith(expect.objectContaining({
    timerId: 'timer-one', recordMode: 'countdown', halfwayAt: NOW + 60_000, deadlineAt: NOW + 120_000,
    halfwaySound: TIMER_AUDIO_SOUNDS.zh.halfway, completeSound: TIMER_AUDIO_SOUNDS.zh.complete, allowStart: true,
    url: 'myapp://timer-notification?timerId=timer-one&recordMode=countdown',
  }));
  expect(retireLegacy).toHaveBeenCalledTimes(1);
  await manager.sync(input({ allowStart: false, locale: 'en' }));
  expect(retireLegacy).toHaveBeenCalledTimes(1);
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    halfwaySound: TIMER_AUDIO_SOUNDS.en.halfway, completeSound: TIMER_AUDIO_SOUNDS.en.complete, allowStart: false,
  }));
});

test('does not read or mutate prior voice channels, even when missing or muted', async () => {
  Notifications.getNotificationChannelAsync.mockResolvedValue({ sound: null, importance: 0 });
  await manager.sync(input()); expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  Notifications.getNotificationChannelAsync.mockResolvedValue(null);
  await manager.sync(input({ allowStart: false }));
  expect(Notifications.getNotificationChannelAsync).not.toHaveBeenCalled();
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  expect(Native.prepareNotificationChannelAsync).toHaveBeenCalledTimes(2);
});

test('Chinese playback uses real Cantonese media independently of an old muted voice channel', async () => {
  const mutedHalfway = 'countdown-reminders-v1-zh-halfway-countdown-yue-halfway-wav';
  Notifications.getNotificationChannelAsync.mockImplementation(async (channel) =>
    channel === 'countdown-reminders-v1' ? { sound: 'default', importance: 4 }
      : channel === mutedHalfway ? { sound: null, importance: 0 } : null);
  await manager.sync(input());
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    halfwaySound: 'countdown_yue_halfway.wav', completeSound: 'countdown_yue_complete.wav',
  }));
  expect(Native.startTimerAudioServiceAsync.mock.calls[0][0]).not.toHaveProperty('halfwayChannel');
  expect(Native.startTimerAudioServiceAsync.mock.calls[0][0]).not.toHaveProperty('completeChannel');
  expect(Notifications.getNotificationChannelAsync).not.toHaveBeenCalled();
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
});

test('English media does not depend on Build 7/8 voice channels and leaves their settings alone', async () => {
  const halfwayChannel = 'countdown-reminders-v1-en-halfway-countdown-en-halfway-wav';
  const completeChannel = 'countdown-reminders-v1-en-complete-countdown-en-complete-wav';
  Notifications.getNotificationChannelAsync.mockImplementation(async (channel) =>
    channel === 'countdown-reminders-v1' ? { sound: 'default', importance: 4 }
      : channel === halfwayChannel ? { sound: null, importance: 0 } : null);
  await manager.sync(input({ locale: 'en' }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    halfwaySound: TIMER_AUDIO_SOUNDS.en.halfway, completeSound: TIMER_AUDIO_SOUNDS.en.complete,
  }));
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
  Notifications.getNotificationChannelAsync.mockImplementation(async (channel) =>
    channel === completeChannel ? { sound: null, importance: 1 } : { sound: 'default', importance: 4 });
  await manager.sync(input({ locale: 'en', allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    halfwaySound: TIMER_AUDIO_SOUNDS.en.halfway, completeSound: TIMER_AUDIO_SOUNDS.en.complete,
  }));
  Notifications.getNotificationChannelAsync.mockImplementation(async (channel) =>
    channel === 'countdown-reminders-v1' ? { sound: null, importance: 4 } : { sound: 'default', importance: 4 });
  await manager.sync(input({ locale: 'en', allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    halfwaySound: TIMER_AUDIO_SOUNDS.en.halfway, completeSound: TIMER_AUDIO_SOUNDS.en.complete,
  }));
  expect(Notifications.getNotificationChannelAsync).not.toHaveBeenCalled();
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
});

test('never requests notification permission, including explicit start and resume', async () => {
  Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
  await manager.sync(input({ allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: false }));
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  await manager.sync(input());
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: true }));
  await manager.sync(input({ allowStart: false }));
  await manager.sync(input());
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('never starts a new service from background; keeps user intent until foreground', async () => {
  AppState.currentState = 'background';
  Native.startTimerAudioServiceAsync.mockResolvedValueOnce({ status: 'needs_start', audioOwned: false });
  await manager.sync(input());
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: false }));
  AppState.currentState = 'active';
  await manager.sync(input({ allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: true }));
});

test('backgrounding during channel preparation does not lose an explicit start request', async () => {
  const preparation = deferred();
  Native.prepareNotificationChannelAsync.mockReturnValueOnce(preparation.promise);
  const old = manager.sync(input()); await flush();
  expect(Native.prepareNotificationChannelAsync).toHaveBeenCalledTimes(1);
  AppState.currentState = 'background';
  const background = manager.sync(input({ allowStart: false }));
  Native.startTimerAudioServiceAsync.mockResolvedValueOnce({ status: 'needs_start', audioOwned: false });
  preparation.resolve({ status: 'prepared' });
  await expect(old).resolves.toMatchObject({ status: 'cancelled' }); await background;
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: false }));
  AppState.currentState = 'active'; await manager.sync(input({ allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: true }));
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('channel preparation completing after abandonment cannot start a stale timer', async () => {
  const preparation = deferred();
  Native.prepareNotificationChannelAsync.mockReturnValueOnce(preparation.promise);
  const sync = manager.sync(input()); await flush();
  const clear = manager.clear(); preparation.resolve({ status: 'prepared' });
  await expect(sync).resolves.toMatchObject({ status: 'cancelled' }); await clear;
  expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: false });
  await manager.sync(input({ allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: false }));
});

test('a late channel preparation cannot transfer explicit start to a restored timer in another account', async () => {
  const preparation = deferred(); Native.prepareNotificationChannelAsync.mockReturnValueOnce(preparation.promise);
  const old = manager.sync(input()); await flush();
  const restored = input({ ownerKey: 'user:two', allowStart: false });
  restored.session = { ...restored.session, timerId: 'restored-two', countdownId: 'restored-two' };
  const next = manager.sync(restored);
  preparation.resolve({ status: 'prepared' });
  await expect(old).resolves.toMatchObject({ status: 'cancelled' }); await next;
  expect(Native.startTimerAudioServiceAsync).toHaveBeenCalledTimes(1);
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    timerId: 'restored-two', allowStart: false,
  }));
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('slow native start is serialized before a clear/new countup and never clears the new timer', async () => {
  const starting = deferred(); Native.startTimerAudioServiceAsync.mockReturnValueOnce(starting.promise);
  const first = manager.sync(input()); await flush();
  const cancel = manager.clear();
  const next = input(); next.session = { ...next.session, timerId: 'countup-new', recordMode: 'countup' };
  const startNext = manager.sync(next);
  starting.resolve({ status: 'updated', audioOwned: true });
  await first; await cancel; await startNext;
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    timerId: 'countup-new', halfwayAt: 0, deadlineAt: 0, allowStart: true,
  }));
  expect(Native.stopTimerAudioServiceAsync.mock.invocationCallOrder.at(-1))
    .toBeLessThan(Native.startTimerAudioServiceAsync.mock.invocationCallOrder.at(-1));
});

test('notification denial does not prevent native media ownership or stop the exercise', async () => {
  Notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
  Native.prepareNotificationChannelAsync.mockResolvedValue({ status: 'denied' });
  Native.startTimerAudioServiceAsync.mockResolvedValue({ status: 'updated', audioOwned: true,
    notificationStatus: 'denied', notificationsEnabled: false });
  await expect(manager.sync(input())).resolves.toMatchObject({ status: 'updated', audioOwned: true,
    notificationStatus: 'denied', notificationsEnabled: false });
  expect(Native.startTimerAudioServiceAsync).toHaveBeenCalledWith(expect.objectContaining({ allowStart: true }));
  expect(Native.stopTimerAudioServiceAsync).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('paused timers never authorize service start or retain milestones', async () => {
  const paused = input(); paused.session = { ...paused.session, running: false, accumulatedSeconds: 20, startedAt: null };
  await manager.sync(paused);
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({
    running: false, startedAt: 0, halfwayAt: 0, deadlineAt: 0, allowStart: false,
  }));
});

test('past or consumed halfway marks cannot replay on reopen/resume', async () => {
  const resumed = input(); resumed.session = { ...resumed.session, accumulatedSeconds: 70, countdownHalfwayAnnounced: true };
  await manager.sync(resumed);
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ halfwayAt: 0, deadlineAt: NOW + 50_000 }));
});

test('natural expiry preserves only already-due native audio, manual finish/discard cuts it off', async () => {
  jest.setSystemTime(NOW + 121_000);
  await manager.sync(input());
  expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: true });
  await manager.sync({ session: null, ownerKey: 'user:one', preserveDue: true });
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: true });
  await manager.clear();
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: false });
});

test('a completed pure countdown does not recreate a paused five-second card or replay cancelled audio', async () => {
  const finished = input();
  finished.session = { ...finished.session, running: false, startedAt: null,
    accumulatedSeconds: 115, completed: true, countdownCompletedNaturally: false };
  await manager.sync(finished);
  expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: false });
  finished.session = { ...finished.session, accumulatedSeconds: 120, countdownCompletedNaturally: true };
  await manager.sync({ ...finished, preserveDue: true });
  expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith({ preserveDue: true });
});

test('channel preparation that outlasts the timer cannot restart it or shift deadline', async () => {
  const preparation = deferred();
  Native.prepareNotificationChannelAsync.mockReturnValueOnce(preparation.promise);
  const sync = manager.sync(input()); await flush(); jest.setSystemTime(NOW + 130_000);
  preparation.resolve({ status: 'prepared' }); await sync;
  expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
  expect(Native.stopTimerAudioServiceAsync).toHaveBeenCalledWith({ preserveDue: true });
});

test('failure to retire old alarms prevents dual audio and can be retried', async () => {
  retireLegacy.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(manager.sync(input())).resolves.toEqual({ status: 'failed' });
  expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
  await expect(manager.sync(input())).resolves.toMatchObject({ status: 'updated' });
});

test('a stored timer/account cannot borrow another start authorization', async () => {
  AppState.currentState = 'background'; Native.startTimerAudioServiceAsync.mockResolvedValue({ status: 'needs_start' });
  await manager.sync(input()); AppState.currentState = 'active';
  await manager.sync(input({ ownerKey: 'user:two', allowStart: false }));
  expect(Native.startTimerAudioServiceAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowStart: false }));
});

test('no service methods run on iOS, Web or an older Android build', async () => {
  Native.isTimerAudioServiceAvailable.mockReturnValue(false);
  await expect(manager.sync(input())).resolves.toMatchObject({ status: 'unavailable' });
  await expect(manager.clear()).resolves.toMatchObject({ status: 'unavailable' });
  expect(retireLegacy).not.toHaveBeenCalled(); expect(Native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
});
