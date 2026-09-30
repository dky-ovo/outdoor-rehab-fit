function loadModule(os, nativeModule) {
  jest.resetModules();
  const optional = jest.fn(() => nativeModule);
  jest.doMock('expo', () => ({ requireOptionalNativeModule: optional }));
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  return { module: require('../index'), optional };
}

afterEach(() => jest.clearAllMocks());

it('reads notification presence without reposting or requiring newer methods in old binaries', async () => {
  const native = { updateAsync: jest.fn(), clearAsync: jest.fn(), getStatusAsync: jest.fn().mockResolvedValue({ status: 'missing' }) };
  const current = loadModule('android', native);
  await expect(current.module.getStatusAsync()).resolves.toEqual({ status: 'missing' });
  expect(native.getStatusAsync).toHaveBeenCalledTimes(1);
  expect(native.updateAsync).not.toHaveBeenCalled();
  const old = loadModule('android', { updateAsync: jest.fn(), clearAsync: jest.fn() });
  await expect(old.module.getStatusAsync()).resolves.toEqual({ status: 'unavailable' });
});

it('keeps older Android binaries safe when the native module is absent', async () => {
  const { module, optional } = loadModule('android', null);
  expect(optional).toHaveBeenCalledWith('SessionTimerNotification');
  expect(module.isSessionTimerNotificationAvailable()).toBe(false);
  await expect(module.updateAsync({})).resolves.toEqual({ status: 'unavailable' });
  await expect(module.clearAsync()).resolves.toEqual({ status: 'unavailable' });
});

it.each(['web'])('does not load the native module on %s', async (os) => {
  const native = { updateAsync: jest.fn(), clearAsync: jest.fn() };
  const { module, optional } = loadModule(os, native);
  expect(optional).not.toHaveBeenCalled();
  expect(module.isSessionTimerNotificationAvailable()).toBe(false);
  await expect(module.updateAsync({})).resolves.toEqual({ status: 'unavailable' });
  expect(native.updateAsync).not.toHaveBeenCalled();
});

it('uses the optional iOS bridge for Live Activities without requiring it in old builds', async () => {
  const native = { updateAsync: jest.fn().mockResolvedValue({ status: 'updated' }), clearAsync: jest.fn().mockResolvedValue({ status: 'cleared' }) };
  const { module, optional } = loadModule('ios', native);
  expect(optional).toHaveBeenCalledWith('SessionTimerNotification');
  expect(module.isSessionTimerNotificationAvailable()).toBe(true);
  await expect(module.updateAsync({ timerId: 'ios-1' })).resolves.toEqual({ status: 'updated' });
  await expect(module.clearAsync()).resolves.toEqual({ status: 'cleared' });
  const old = loadModule('ios', null);
  await expect(old.module.updateAsync({})).resolves.toEqual({ status: 'unavailable' });
});

it('rejects incomplete native implementations without a hard crash', async () => {
  const { module } = loadModule('android', { updateAsync: jest.fn() });
  expect(module.isSessionTimerNotificationAvailable()).toBe(false);
  await expect(module.clearAsync()).resolves.toEqual({ status: 'unavailable' });
});

it('forwards timer identity, timing, text and guarded deep link without modification', async () => {
  const native = { updateAsync: jest.fn().mockResolvedValue({ status: 'updated' }), clearAsync: jest.fn() };
  const { module } = loadModule('android', native);
  const options = {
    timerId: 'session-1', recordMode: 'countdown', running: true,
    startedAt: 1788840000000, accumulatedSeconds: 32, targetDurationSec: 300,
    title: '倒數計時器', body: '點按返回計時器。', channelName: '運動計時器',
    url: 'myapp://timer-notification?timerId=session-1&recordMode=countdown',
  };
  await expect(module.updateAsync(options)).resolves.toEqual({ status: 'updated' });
  expect(native.updateAsync).toHaveBeenCalledWith(options);
});

it('converts a paused null start time into the numeric native bridge value', async () => {
  const native = { updateAsync: jest.fn().mockResolvedValue({ status: 'updated' }), clearAsync: jest.fn() };
  const { module } = loadModule('android', native);
  const options = { timerId: 'countup-1', recordMode: 'countup', running: false, startedAt: null };
  await module.updateAsync(options);
  expect(native.updateAsync).toHaveBeenCalledWith({ ...options, startedAt: 0 });
  expect(options.startedAt).toBeNull();
});

it.each([null, undefined, 'invalid', []])('does not bridge an invalid options container: %p', async (options) => {
  const native = { updateAsync: jest.fn(), clearAsync: jest.fn() };
  const { module } = loadModule('android', native);
  await expect(module.updateAsync(options)).resolves.toEqual({ status: 'invalid' });
  expect(native.updateAsync).not.toHaveBeenCalled();
});

it('clears the native notification exactly once and preserves its result', async () => {
  const native = { updateAsync: jest.fn(), clearAsync: jest.fn().mockResolvedValue({ status: 'cleared' }) };
  const { module } = loadModule('android', native);
  await expect(module.clearAsync()).resolves.toEqual({ status: 'cleared' });
  expect(native.clearAsync).toHaveBeenCalledTimes(1);
});

it('preserves denied/expired results for the caller to handle', async () => {
  const native = {
    updateAsync: jest.fn().mockResolvedValueOnce({ status: 'denied' }).mockResolvedValueOnce({ status: 'expired' }),
    clearAsync: jest.fn(),
  };
  const { module } = loadModule('android', native);
  await expect(module.updateAsync({})).resolves.toEqual({ status: 'denied' });
  await expect(module.updateAsync({})).resolves.toEqual({ status: 'expired' });
});

it.each(['prepareNotificationChannelAsync', 'checkReminderSettingsAsync', 'openExactAlarmSettingsAsync', 'openNotificationSettingsAsync'])('keeps new %s optional and Android-only', async (method) => {
  const native = { updateAsync: jest.fn(), clearAsync: jest.fn(), [method]: jest.fn().mockResolvedValue({ status: 'available' }) };
  const android = loadModule('android', native);
  await expect(android.module[method]('Current timer')).resolves.toEqual({ status: 'available' });
  expect(native[method]).toHaveBeenCalledTimes(1);
  const old = loadModule('android', { updateAsync: jest.fn(), clearAsync: jest.fn() });
  await expect(old.module[method]()).resolves.toEqual({ status: 'unavailable' });
  const ios = loadModule('ios', native);
  await expect(ios.module[method]()).resolves.toEqual({ status: 'unavailable' });
  expect(native[method]).toHaveBeenCalledTimes(1);
});

it('propagates a native failure so the caller cannot falsely report a notification as posted', async () => {
  const error = new Error('Notification service unavailable');
  const native = { updateAsync: jest.fn().mockRejectedValue(error), clearAsync: jest.fn() };
  const { module } = loadModule('android', native);
  await expect(module.updateAsync({})).rejects.toBe(error);
});

it('uses native countdown alarms only if both new methods are present, leaving Build 7 and iOS on fallback', async () => {
  const native = { scheduleCountdownRemindersAsync: jest.fn().mockResolvedValue({ status: 'scheduled' }),
    clearCountdownRemindersAsync: jest.fn().mockResolvedValue({ status: 'cleared' }) };
  const current = loadModule('android', native);
  expect(current.module.isNativeCountdownReminderAvailable()).toBe(true);
  await expect(current.module.scheduleCountdownRemindersAsync({ timerId: 'one' })).resolves.toEqual({ status: 'scheduled' });
  expect(native.scheduleCountdownRemindersAsync).toHaveBeenCalledWith({ timerId: 'one' });
  await current.module.clearCountdownRemindersAsync({ preserveDue: true });
  expect(native.clearCountdownRemindersAsync).toHaveBeenCalledWith(true, false);
  await current.module.clearCountdownRemindersAsync({ expiredOnly: true });
  expect(native.clearCountdownRemindersAsync).toHaveBeenCalledWith(false, true);
  for (const os of ['ios', 'web']) {
    const other = loadModule(os, native);
    expect(other.module.isNativeCountdownReminderAvailable()).toBe(false);
    await expect(other.module.scheduleCountdownRemindersAsync({})).resolves.toEqual({ status: 'unavailable' });
  }
  const old = loadModule('android', { updateAsync: jest.fn(), clearAsync: jest.fn() });
  expect(old.module.isNativeCountdownReminderAvailable()).toBe(false);
  await expect(old.module.clearCountdownRemindersAsync()).resolves.toEqual({ status: 'unavailable' });
});

it('requires the complete foreground audio service contract and does not mistake Build 8 alarms for it', async () => {
  const old = loadModule('android', { scheduleCountdownRemindersAsync: jest.fn(), clearCountdownRemindersAsync: jest.fn() });
  expect(old.module.isTimerAudioServiceAvailable()).toBe(false);
  await expect(old.module.startTimerAudioServiceAsync({})).resolves.toEqual({ status: 'unavailable' });
  const native = { startTimerAudioServiceAsync: jest.fn().mockResolvedValue({ status: 'updated', audioOwned: true }),
    stopTimerAudioServiceAsync: jest.fn().mockResolvedValue({ status: 'finishing' }),
    getTimerAudioServiceStatusAsync: jest.fn().mockResolvedValue({ status: 'updated', lastCueOutcome: 'played' }) };
  const next = loadModule('android', native);
  expect(next.module.isTimerAudioServiceAvailable()).toBe(true);
  await expect(next.module.startTimerAudioServiceAsync({ timerId: 'native-next', startedAt: null })).resolves.toMatchObject({ audioOwned: true });
  expect(native.startTimerAudioServiceAsync).toHaveBeenCalledWith({ timerId: 'native-next', startedAt: 0 });
  await next.module.stopTimerAudioServiceAsync({ preserveDue: true });
  expect(native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith(true);
  await next.module.stopTimerAudioServiceAsync();
  expect(native.stopTimerAudioServiceAsync).toHaveBeenLastCalledWith(false);
  await expect(next.module.getTimerAudioServiceStatusAsync()).resolves.toMatchObject({ lastCueOutcome: 'played' });
  for (const os of ['ios', 'web']) {
    const other = loadModule(os, native);
    expect(other.module.isTimerAudioServiceAvailable()).toBe(false);
    await expect(other.module.startTimerAudioServiceAsync({})).resolves.toEqual({ status: 'unavailable' });
  }
});

it.each([null, undefined, 'invalid', []])('audio bridge rejects invalid options: %p', async (options) => {
  const native = { startTimerAudioServiceAsync: jest.fn(), stopTimerAudioServiceAsync: jest.fn(), getTimerAudioServiceStatusAsync: jest.fn() };
  const current = loadModule('android', native);
  await expect(current.module.startTimerAudioServiceAsync(options)).resolves.toEqual({ status: 'invalid' });
  expect(native.startTimerAudioServiceAsync).not.toHaveBeenCalled();
});
