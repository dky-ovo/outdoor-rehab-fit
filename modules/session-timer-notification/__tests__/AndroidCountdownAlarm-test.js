const fs = require('fs');
const path = require('path');
const directory = path.join(__dirname, '../android/src/main');
const source = fs.readFileSync(path.join(directory, 'java/expo/modules/sessiontimernotification/CountdownReminderReceiver.kt'), 'utf8');
const bridge = fs.readFileSync(path.join(directory, 'java/expo/modules/sessiontimernotification/SessionTimerNotificationModule.kt'), 'utf8');
const receiver = fs.readFileSync(path.join(directory, 'java/expo/modules/sessiontimernotification/TimerExpiryReceiver.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(directory, 'AndroidManifest.xml'), 'utf8');

test('Android countdown uses user-visible alarm-clock delivery, with explicit permission and inexact fallback', () => {
  expect(source).toContain('Build.VERSION.SDK_INT < 31 || alarm.canScheduleExactAlarms()');
  expect(source).toContain('alarm.setAlarmClock(AlarmManager.AlarmClockInfo(at, open), operation)');
  expect(source).toContain('alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)');
  expect(source).toContain('"exactAlarmsAllowed" to exactAllowed');
  expect(source).not.toMatch(/alarm\.setExactAndAllowWhileIdle|startForegroundService|startService|MediaPlayer\(|setBypassDnd\(true\)|acquire\(/);
  expect(manifest).toContain('android.permission.SCHEDULE_EXACT_ALARM');
  expect(manifest).not.toMatch(/USE_EXACT_ALARM|USE_FULL_SCREEN_INTENT/);
});

test('receiver is private and persistence/token validation precedes notification delivery', () => {
  expect(manifest).toMatch(/CountdownReminderReceiver"[\s\S]*?android:exported="false"/);
  expect(source).toContain('if (intent.action != CountdownReminderController.ACTION) return');
  expect(source).toContain('PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE');
  expect(source).toContain('PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE');
  expect(source).toContain('intent.getStringExtra("token") != store.getString("token", null)');
  expect(source).toContain('store.getLong("${phase}At", 0L) != at || store.getBoolean("${phase}Delivered", false)');
  expect(source.indexOf('store.edit().putBoolean("${phase}Delivered", true).commit()')).toBeLessThan(source.indexOf('manager.notify(TAG, id(phase), builder.build())'));
});

test('same clock keeps delivered flags across permission/language changes and same plan does not re-arm live alarms', () => {
  expect(source).toContain('val fired = phases.associateWith { sameClock && store.getBoolean("${it}Delivered", false) }');
  expect(source).toContain('if (samePlan && scheduledInThisProcessKey == options.key && pending(context, phase) != null) continue');
  expect(source).toContain('private var scheduledInThisProcessKey: String? = null');
  expect(source).toContain('store.getBoolean("exactAlarmsAllowed", !exactAllowed) == exactAllowed');
  expect(source).toContain('.putBoolean("exactAlarmsAllowed", exactAllowed)');
  expect(source).toContain('if (at <= System.currentTimeMillis() || store.getBoolean("${phase}Delivered", false)) continue');
  expect(source).toContain('.putBoolean("halfwayDelivered", fired["halfway"] == true)');
  expect(source).toContain('.putBoolean("completeDelivered", fired["complete"] == true)');
});

test('actual native activity lifecycle and lockscreen state suppress foreground duplicates, not suspended JS callbacks', () => {
  const foreground = bridge.slice(bridge.indexOf('OnActivityEntersForeground {'), bridge.indexOf('OnActivityEntersBackground'));
  expect(foreground).toContain('CountdownReminderController.setActivityForeground(true)');
  expect(foreground).toContain('TimerAudioServiceController.reconcileDeadline()');
  expect(bridge).toContain('OnActivityEntersBackground { CountdownReminderController.setActivityForeground(false) }');
  expect(bridge).toContain('OnActivityDestroys { CountdownReminderController.setActivityForeground(false) }');
  expect(source).toContain('@Volatile private var activityForeground = false');
  expect(source).toContain('if (interactive && !locked && activityForeground) return');
  expect(source).not.toMatch(/getMyMemoryState|ReactContext|sendEvent|HeadlessJs|Javascript|AppState\./);
});

test('late halfway does not replay; late completion is quiet without altering notification channels', () => {
  expect(source).toContain('private const val MAX_LATENESS_MS = 10000L');
  expect(source).toContain('if (late && phase == "halfway" || !mayNotify(context)) return');
  expect(source).toContain('builder.setGroup("outdoor-fit-expired-countdown").setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)');
  expect(source).toContain('sound.isBlank() || late -> null');
  expect(source).not.toMatch(/createNotificationChannel|deleteNotificationChannel|setStreamVolume|setRingerMode/);
  expect(source).toContain('getNotificationChannel(channelId)?.importance == NotificationManager.IMPORTANCE_NONE');
});

test('pause/abandon cancel their alarm PendingIntents, natural finish allows an already due receiver', () => {
  expect(source).toContain('alarmManager(context).cancel(it); it.cancel()');
  expect(source).toContain('if (expiredOnly) at > 0L && now - at > MAX_LATENESS_MS else !preserveDue || !due');
  expect(source).toContain('if (!preserveDue && !expiredOnly) editor.clear()');
  expect(bridge).toContain('CountdownReminderController.clear(context, preserveDue, expiredOnly)');
});

test('countup status distinguishes actual user dismissal from OS loss with identity-scoped delete intent', () => {
  expect(bridge).toContain('.setDeleteIntent(dismissIntent)');
  expect(receiver).toContain('TimerNotificationController.dismissed(context, intent.getStringExtra("timerId"), intent.getStringExtra("displayToken"))');
  expect(bridge).toContain('display.getString("timerId", null) == timerId && display.getString("displayToken", null) == displayToken');
  expect(bridge).toContain('.setData(Uri.parse("outdoor-fit-timer-dismiss://$displayToken"))');
  expect(bridge).toContain('"recoverableMissing" to !dismissed');
  expect(bridge).toContain('service == null && !options.restoreDismissed && display.getString("dismissedTimerId", null) == options.timerId');
  expect(bridge).toContain('context.getSharedPreferences(DISPLAY_PREFERENCES, Context.MODE_PRIVATE).edit().clear().apply()');
});
