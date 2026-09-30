const fs = require("fs");
const path = require("path");

const moduleSource = fs.readFileSync(path.join(__dirname, "../android/src/main/java/expo/modules/sessiontimernotification/SessionTimerNotificationModule.kt"), "utf8");
const method = moduleSource.slice(moduleSource.indexOf("fun getStatus(context:"), moduleSource.indexOf("\n  @Synchronized\n  fun update("));

test("Android exports a read-only status bridge using the current native context", () => {
	expect(moduleSource).toMatch(/AsyncFunction\("getStatusAsync"\)\s*\{\s*val context = appContext\.reactContext \?: throw Exceptions\.ReactContextLost\(\)\s*TimerNotificationController\.getStatus\(context\)/);
});

test("explicit channel preparation uses the same safe migration before requesting Android 13 permission without posting a card", () => {
	expect(moduleSource).toContain('AsyncFunction("prepareNotificationChannelAsync") { channelName: String ->');
	const prepare = moduleSource.slice(moduleSource.indexOf("fun prepareNotificationChannel("), moduleSource.indexOf("fun getStatus(context:"));
	expect(prepare).toContain("if (Build.VERSION.SDK_INT >= 26) ensureChannel(manager, channelName)");
	expect(prepare).toContain('notificationStatus(manager, "prepared")');
	expect(prepare).not.toMatch(/\.notify\(|\.cancel\(|scheduleExpiry|requestPermissions|startActivity/);
});

test("status checks Android 13 permission, global authorization and the existing timer channel", () => {
	expect(method).toContain("Build.VERSION.SDK_INT >= 33");
	expect(method).toContain('context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED');
	expect(method).toContain("!manager.areNotificationsEnabled()");
	expect(method).toContain("Build.VERSION.SDK_INT >= 26");
	expect(method).toContain("existingChannel(manager)?.importance == NotificationManager.IMPORTANCE_NONE");
	expect(method.match(/return notificationStatus\(manager, "denied"\)/g)).toHaveLength(3);
});

test("presence requires the same dedicated tag and notification ID, never another app notice", () => {
	expect(moduleSource).toContain('private const val TAG = "outdoor-fit-active-timer"');
	expect(moduleSource).toContain("private const val NOTIFICATION_ID = 741082");
	expect(method).toContain("manager.activeNotifications.any { (it.tag == TAG || it.tag == null) &&");
	expect(method).toContain("(it.id == NOTIFICATION_ID || it.id == COMPLETION_NOTIFICATION_ID)");
	expect(method).toContain('notificationStatus(manager, if (visible) "visible" else if (dismissed) "suppressed" else "missing")');
	expect(method).toContain('mapOf("recoverableMissing" to !dismissed)');
});

test("new installs use a normal-importance quiet channel and existing explicit choices keep their original channel", () => {
	expect(moduleSource).toContain('private const val CHANNEL_ID = "session-timer-status-v2"');
	expect(moduleSource).toContain('private const val LEGACY_CHANNEL_ID = "session-timer-status-v1"');
	const ensure = moduleSource.slice(moduleSource.indexOf("private fun ensureChannel("), moduleSource.indexOf("private fun notificationStatus("));
	expect(ensure).toContain("manager.getNotificationChannel(CHANNEL_ID)?.let { return it }");
	expect(ensure).toContain("Build.VERSION.SDK_INT >= 29 &&");
	expect(ensure).toContain("!legacy.hasUserSetImportance()");
	expect(ensure).toContain("legacy.importance == NotificationManager.IMPORTANCE_LOW");
	expect(ensure).toContain("legacy.lockscreenVisibility != Notification.VISIBILITY_PRIVATE");
	expect(ensure).toContain("legacy.lockscreenVisibility != Notification.VISIBILITY_SECRET");
	expect(ensure).toContain("!(Build.VERSION.SDK_INT >= 30 && legacy.hasUserSetSound())");
	expect(ensure).toContain("legacy.group == null && legacy.sound == null && !legacy.shouldVibrate()");
	expect(ensure).toContain("!legacy.canShowBadge() && !legacy.shouldShowLights()");
	expect(ensure).toContain("if (!canUpgradeDefault) return legacy");
	expect(ensure.indexOf("if (!canUpgradeDefault) return legacy")).toBeLessThan(ensure.indexOf("manager.createNotificationChannel(channel)"));
	expect(ensure).toContain("CHANNEL_ID, channelName.take(100), NotificationManager.IMPORTANCE_DEFAULT");
	expect(ensure).toContain("setSound(null, null)");
	expect(ensure).toContain("enableVibration(false)");
	expect(moduleSource).not.toMatch(/deleteNotificationChannel|setBypassDnd\(true\)/);
});

test("posting uses the selected channel and presence does not claim unrestricted lock-screen visibility", () => {
	expect(moduleSource).toContain("val channel = ensureChannel(manager, options.channelName)");
	expect(moduleSource).toContain("Notification.Builder(context, channelId)");
	expect(moduleSource).toContain('"channelId" to (channel?.id ?: CHANNEL_ID)');
	expect(moduleSource).toContain('"lockscreenRestricted" to reason.isNotEmpty()');
	expect(moduleSource).toContain('"lockscreenReason" to reason');
	expect(moduleSource).toContain('-> "channel_privacy"');
	expect(moduleSource).toContain('channel.importance < NotificationManager.IMPORTANCE_DEFAULT -> "channel_silent"');
	expect(moduleSource).toContain('val notificationState = if (notificationsEnabled) "updated" else "denied"');
	expect(moduleSource).toContain('"status" to "updated", "notificationStatus" to notificationState');
	expect(moduleSource).toContain("builder.setPriority(Notification.PRIORITY_DEFAULT).setSound(null).setVibrate(null).setDefaults(0)");
});

test("special-alarm access is read-only until the separate user-action bridge opens settings", () => {
	const check = moduleSource.slice(moduleSource.indexOf("fun checkReminderSettings("), moduleSource.indexOf("fun openExactAlarmSettings("));
	expect(check).toContain("Build.VERSION.SDK_INT < 31 || alarmManager.canScheduleExactAlarms()");
	expect(check).toContain('"exactAlarmsAllowed" to allowed');
	expect(check).not.toMatch(/startActivity|openSettings|requestPermissions|setExact/);
	const open = moduleSource.slice(moduleSource.indexOf("fun openExactAlarmSettings("), moduleSource.indexOf("fun openNotificationSettings("));
	expect(open).toContain("Build.VERSION.SDK_INT < 31 ||");
	expect(open).toContain(".canScheduleExactAlarms()");
	expect(open).toContain("Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM");
	expect(open).toContain('Uri.parse("package:${context.packageName}")');
	expect(moduleSource).not.toContain("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS");
	for (const bridge of ["checkReminderSettingsAsync", "openExactAlarmSettingsAsync", "openNotificationSettingsAsync"]) {
		expect(moduleSource).toContain(`AsyncFunction("${bridge}")`);
	}
});

test("notification settings opens the preserved channel, not an assumed replacement ID", () => {
	const open = moduleSource.slice(moduleSource.indexOf("fun openNotificationSettings("), moduleSource.indexOf("private fun openSettings("));
	expect(open).toContain("val channel = existingChannel(manager)");
	expect(open).toContain("Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS");
	expect(open).toContain(".putExtra(Settings.EXTRA_CHANNEL_ID, channel.id)");
	expect(moduleSource).toContain("catch (_: ActivityNotFoundException)");
});

test("status never posts, cancels, recreates a channel, schedules alarms or writes preferences", () => {
	expect(method).not.toMatch(/\.notify\(|\.cancel\(|clear\(context\)|createNotificationChannel|scheduleExpiry|\.edit\(|requestPermissions|startActivity/);
	expect(method).toContain("catch (_: SecurityException)");
	expect(method).toMatch(/catch \(_: SecurityException\)\s*\{\s*mapOf\("status" to "denied"\)/);
});
