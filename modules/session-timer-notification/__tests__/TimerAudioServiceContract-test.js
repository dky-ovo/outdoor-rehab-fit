const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../android/src/main');
const native = fs.readFileSync(path.join(root, 'java/expo/modules/sessiontimernotification/TimerAudioService.kt'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'java/expo/modules/sessiontimernotification/SessionTimerNotificationModule.kt'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');

test('special-use timer FGS and real playback phase have accurate Android 14 types and no silent-loop workaround', () => {
  for (const permission of ['FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_SPECIAL_USE', 'FOREGROUND_SERVICE_MEDIA_PLAYBACK', 'WAKE_LOCK']) {
    expect(manifest).toContain(`android.permission.${permission}`);
  }
  expect(manifest).toContain('android:foregroundServiceType="specialUse|mediaPlayback"');
  expect(manifest).toContain('android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE');
  expect(bridge).toContain('ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or');
  expect(bridge).toContain('(if (mediaPlaying) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)');
  expect(native).toContain('next.isLooping = false');
  expect(native).not.toMatch(/isLooping\s*=\s*true|setVolume|setStreamVolume|setRingerMode|requestIgnoreBatteryOptimizations/);
  expect(manifest).not.toMatch(/USE_FULL_SCREEN_INTENT|REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|USE_EXACT_ALARM/);
});

test('service and legacy notification bridges serialize on main and only resolve initial start after promotion', () => {
  for (const method of ['startTimerAudioServiceAsync', 'stopTimerAudioServiceAsync', 'getTimerAudioServiceStatusAsync']) expect(bridge).toContain(`AsyncFunction("${method}")`);
  expect(bridge.match(/runOnQueue\(Queues.MAIN\)/g)).toHaveLength(5);
  expect(bridge).toContain('activity.hasWindowFocus() || CountdownReminderController.isActivityForeground()');
  expect(bridge).toContain('!activity.isFinishing && !activity.isDestroyed && interactive && !locked');
  expect(native).toContain('if (!options.allowStart || !visible)');
  expect(native).toContain('waitingToken = next.token; waiting = done');
  expect(native).toContain('TimerAudioServiceController.ready(plan.token, result)');
  expect(native.indexOf('val result = refresh()')).toBeLessThan(native.indexOf('TimerAudioServiceController.ready(plan.token, result)'));
});

test('late legacy JS updates and cleanup cannot overwrite active native cards or resurrect completed seconds', () => {
  const guard = native.slice(native.indexOf('fun legacyNotificationResult('), native.indexOf('fun status(context:'));
  expect(guard).toContain('if (service != null) return status(context)');
  expect(guard).toContain('if (completedTimerId == timerId) return mapOf("status" to "expired", "audioOwned" to true)');
  const updateBridge = bridge.slice(bridge.indexOf('AsyncFunction("updateAsync")'), bridge.indexOf('AsyncFunction("getStatusAsync")'));
  expect(updateBridge).toContain('TimerAudioServiceController.legacyNotificationResult(context, options.timerId)');
  expect(updateBridge).toContain('?: TimerNotificationController.update(context, options)');
  expect(updateBridge).toContain('if (TimerAudioServiceController.service != null) TimerAudioServiceController.status(context)');
  expect(updateBridge.match(/runOnQueue\(Queues.MAIN\)/g)).toHaveLength(2);
});

test('startup/refresh failure tears down ownership so JS fallback cannot overlap a live player', () => {
  expect(native).toContain('if (result["status"] != "updated") stop(context)');
  expect(native).toContain('"status" to "needs_start", "audioOwned" to false');
  expect(native).toContain('"status" to "failed", "audioOwned" to false');
  expect(native).toContain('if (waitingToken == next.token)');
  expect(native).toContain('}, 4000L)');
  expect(native).toContain('if (result["status"] != "updated") TimerAudioServiceController.stop(this)');
  expect(native).toContain('else if (outcome == "start_failed")');
});

test('one status card replaces old tagged cards, starts immediately and never sounds alongside MediaPlayer', () => {
  expect(bridge).toContain('manager.cancel(TAG, NOTIFICATION_ID)');
  expect(bridge).toContain('service.startForeground(foregroundId, builder.build(), type)');
  expect(bridge).toContain('manager.cancel(NOTIFICATION_ID)');
  expect(bridge).toContain('(it.id == NOTIFICATION_ID || it.id == COMPLETION_NOTIFICATION_ID)');
  expect(bridge).toContain('builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)');
  expect(bridge).toContain('builder.setGroup("outdoor-fit-audio-timer-status").setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)');
});

test('absolute monotonic phases claim once and do not replay late or canceled callback generations', () => {
  expect(native).toContain('createdElapsed + (options.halfwayAt.roundToLong() - createdWall)');
  expect(native).toContain('createdElapsed + (options.deadlineAt.roundToLong() - createdWall)');
  expect(native).toContain('now < at || !plan.claimed.add(phase)');
  expect(native).toContain('TimerAudioServiceController.plan?.token != plan.token');
  expect(native).toContain('player === next && playGeneration == generation');
  expect(native).toContain('TimerAudioServiceController.setOutcome(phase, "late")');
  expect(native).toContain('if (finishing) return');
  expect(native).toContain('if (current.finishing || late in 0..MAX_LATENESS_MS)');
});

test('natural completion ownership survives service teardown until explicit cancel or the next user start', () => {
  expect(native).toContain('completedTimerId = current.options.timerId; completedDeadline = current.options.deadlineAt');
  expect(native).toContain('TimerAudioServiceController.claimCompletion(plan)');
  expect(native).toContain('if (completedTimerId == options.timerId && completedDeadline == options.deadlineAt)');
  expect(native).toContain('if (preserveDue && current == null && completedTimerId != null)');
  expect(native).toContain('if (!preserveDue) { completedTimerId = null; completedDeadline = null }');
  expect(native).toContain('mapOf("status" to "cleared", "audioOwned" to true)');
});

test('running countdown text is clamped from the original monotonic deadline, including a refresh crossing zero', () => {
  const refresh = native.slice(native.indexOf('fun refresh():'), native.indexOf('fun soundAvailable():'));
  expect(refresh).toContain('current?.takeIf { it.countdown }');
  expect(refresh).toContain('max(0L, it.deadlineElapsed - SystemClock.elapsedRealtime())');
  expect(refresh).toContain('val options = presentation(remaining)');
  expect(refresh).toContain('val ended = finishing || remaining == 0L');
  expect(refresh).toContain('TimerNotificationController.update(this, options, this, mediaPlaying, ended,');
  expect(refresh).toContain('countdownRemainingMs = remaining');
  expect(refresh).not.toContain('System.currentTimeMillis()');
  const present = native.slice(native.indexOf('private fun presentation('), native.indexOf('fun refresh():'));
  expect(present).toContain('if (!finishing && remaining != 0L) return source');
  expect(present).toContain('running = false');
  expect(present).toContain('accumulatedSeconds = source.targetDurationSec');
  expect(present).toContain('statusLabel = source.finishedLabel');
  expect(bridge).toContain('val remainingMs = countdownRemainingMs?.coerceAtLeast(0L)');
});

test('only the active countdown schedules second-boundary updates and late callbacks finish immediately without drift', () => {
  const schedule = native.slice(native.indexOf('private fun queueCountdownUpdate('), native.indexOf('private fun holdCountdownWakeLock('));
  expect(schedule).toContain('if (closed || finishing || !plan.countdown || current?.token != plan.token ||');
  expect(schedule).toContain('TimerAudioServiceController.plan?.token != plan.token) return');
  expect(schedule).toContain('val remaining = plan.deadlineElapsed - SystemClock.elapsedRealtime()');
  expect(schedule).toContain('if (remaining <= 0L) { milestone("complete"); return }');
  expect(schedule).toContain('if (now >= plan.deadlineElapsed) {\n          milestone("complete")');
  expect(schedule).toContain('handler.postDelayed(tick, ((remaining - 1L) % 1000L) + 1L)');
  expect(schedule).not.toMatch(/remaining\s*-=|remaining--|deadlineElapsed\s*=|startedAt\s*=/);
  expect(schedule).toContain('if (result["status"] != "updated") TimerAudioServiceController.stop(this)');
});

test('completion freezes zero before audio preparation while keeping the end message alive until completion', () => {
  const milestone = native.slice(native.indexOf('fun milestone('), native.indexOf('fun finishDue('));
  const complete = milestone.slice(milestone.indexOf('if (phase == "complete") {'), milestone.indexOf('val late ='));
  expect(complete).toContain('TimerAudioServiceController.claimCompletion(plan)');
  expect(complete.indexOf('finishing = true')).toBeLessThan(complete.indexOf('stopCountdownUpdates()'));
  expect(complete.indexOf('stopCountdownUpdates()')).toBeLessThan(complete.indexOf('val frozen = refresh()'));
  expect(milestone.indexOf('val frozen = refresh()')).toBeLessThan(milestone.indexOf('val blocked = blockedReason(phase)'));
  expect(milestone.indexOf('val frozen = refresh()')).toBeLessThan(milestone.indexOf('play(phase, plan, at)'));
  expect(complete).toContain('if (frozen["status"] != "updated") {');
  expect(complete).toContain('TimerAudioServiceController.finish(this, plan.token)');
  const play = native.slice(native.indexOf('private fun play('), native.indexOf('private fun releasePlayer('));
  expect(play).toContain('next.setOnCompletionListener { done("played") }');
  expect(play).toContain('if (phase == "complete") {\n        TimerAudioServiceController.finish(this, plan.token)');
});

test('pause, abandon and teardown remove the countdown updater as well as audio and alarms', () => {
  const clearTick = native.slice(native.indexOf('private fun stopCountdownUpdates('), native.indexOf('private fun queueCountdownUpdate('));
  expect(clearTick).toContain('countdownTick?.let { handler.removeCallbacks(it) }');
  expect(clearTick).toContain('countdownTick = null');
  const shutdown = native.slice(native.indexOf('fun shutdown('), native.indexOf('override fun onTaskRemoved('));
  expect(shutdown).toContain('closed = true\n    stopCountdownUpdates()');
  expect(shutdown).toContain('handler.removeCallbacksAndMessages(null)');
  expect(shutdown).toContain('releasePlayer(); releaseWakeLock()');
  expect(shutdown).toContain('stopForeground(STOP_FOREGROUND_REMOVE)');
});

test('unchanged second snapshots do not repeat foreground promotion or queue extra notification updates', () => {
  const refresh = native.slice(native.indexOf('fun refresh():'), native.indexOf('fun soundAvailable():'));
  expect(refresh).toContain('val foregroundState = listOf(current?.token, ended, mediaPlaying)');
  expect(refresh).toContain('remaining?.let { (it + 999L) / 1000L }');
  expect(refresh).toContain('if (lastPresentation == presentationKey)');
  expect(refresh).toContain('lastPresentationResult?.let { return it + TimerAudioServiceController.diagnostic() }');
  expect(refresh).toContain('updateForeground = lastForegroundState != foregroundState');
  expect(refresh).toContain('lastNotificationPostAt = SystemClock.elapsedRealtime(); notificationPostCount += 1');
  expect(refresh).toContain('lastPresentation = presentationKey');
  const update = bridge.slice(bridge.indexOf('fun update(context:'), bridge.indexOf('private fun existingChannel('));
  expect(update).toContain('if (!updateForeground) {');
  expect(update).toContain('manager.notify(foregroundId, builder.build())');
  expect(update).toContain('} else if (Build.VERSION.SDK_INT >= 34) {');
  expect(update).toContain('if (!sameDisplay) manager.cancel(TAG, NOTIFICATION_ID)');
  expect(update).toContain('val displayToken = if (sameDisplay)');
  expect(update).toContain('if (!sameDisplay) display.edit()');
  expect(update).toContain('if (service == null || !sameDisplay) cancelExpiry(context)');
});

test('completion removes the old seconds card before posting a different fixed-zero foreground card', () => {
  expect(bridge).toContain('private const val COMPLETION_NOTIFICATION_ID = 741085');
  expect(bridge).toContain('val foregroundId = if (finishing) COMPLETION_NOTIFICATION_ID else NOTIFICATION_ID');
  const update = bridge.slice(bridge.indexOf('fun update(context:'), bridge.indexOf('private fun existingChannel('));
  expect(update).not.toMatch(/stopForeground|stopService|stopSelf/);
  expect(update.indexOf('service.startForeground(foregroundId, builder.build(), type)')).toBeLessThan(update.indexOf('if (finishing) manager.cancel(NOTIFICATION_ID)'));
  const clear = bridge.slice(bridge.indexOf('fun clear(context:'), bridge.indexOf('fun dismissed('));
  expect(clear).toContain('manager.cancel(TAG, NOTIFICATION_ID)');
  expect(clear).toContain('manager.cancel(NOTIFICATION_ID)');
  expect(clear).toContain('manager.cancel(COMPLETION_NOTIFICATION_ID)');
  const complete = native.slice(native.indexOf('if (phase == "complete") {', native.indexOf('fun milestone(')), native.indexOf('val late =', native.indexOf('fun milestone(')));
  expect(complete).toContain('lastPresentation = null; lastPresentationResult = null; lastForegroundState = null');
  expect(complete.indexOf('lastForegroundState = null')).toBeLessThan(complete.indexOf('val frozen = refresh()'));
});

test('same-clock locale refresh updates all labels without rebuilding its absolute clock', () => {
  const refresh = native.slice(native.indexOf('if (active != null && existing?.sameClock(options)'), native.indexOf('// Starting/replacing a service'));
  for (const field of ['title', 'body', 'statusLabel', 'locale', 'modeLabel', 'timeLabel', 'openLabel', 'finishedLabel', 'channelName', 'halfwaySound', 'completeSound']) {
    expect(refresh).toContain(`existing.options.${field} = options.${field}`);
  }
  expect(refresh).not.toMatch(/startedAt =|deadlineAt =|halfwayAt =|TimerAudioPlan\(/);
});

test('focus is acquired only after FGS promotion; delayed gain and old player callbacks cannot play later', () => {
  const play = native.slice(native.indexOf('private fun play('), native.indexOf('private fun releasePlayer('));
  expect(play.indexOf('val promoted = refresh()')).toBeLessThan(play.indexOf('audio.requestAudioFocus(request)'));
  expect(play).toContain('.setAcceptsDelayedFocusGain(false)');
  expect(play).toContain('if (!granted) { done("focus_denied"); return }');
  expect(play).toContain('if (!isCurrent()) return@setOnPreparedListener');
  expect(play).toContain('try {\n          next.start()');
  expect(play).toContain('catch (_: Exception) { done("playback_failed") }');
  expect(play).toContain('handler.postDelayed({ if (isCurrent()) done("playback_timeout") }, 15000L)');
});

test('a pending old-language prepare cannot begin after a same-clock locale switch', () => {
  const prepared = native.slice(native.indexOf('next.setOnPreparedListener {'), native.indexOf('next.setOnCompletionListener'));
  expect(prepared).toContain('val expectedSound = if (phase == "halfway") plan.options.halfwaySound else plan.options.completeSound');
  expect(prepared).toContain('if (sourceName != expectedSound) { done("language_changed"); return@setOnPreparedListener }');
  expect(prepared.indexOf('if (sourceName != expectedSound)')).toBeLessThan(prepared.indexOf('next.start()'));
  expect(prepared).not.toContain('plan.claimed.remove');
});

test('app media honours media volume, DND and calls without inheriting unrelated ringtone or notification-channel mute', () => {
  const blocked = native.slice(native.indexOf('private fun readBlockedReason('), native.indexOf('private fun play('));
  expect(blocked).not.toMatch(/ringerMode|RINGER_MODE|mayNotify|POST_NOTIFICATIONS|getNotificationChannel|channel\.sound|channel\.importance/);
  expect(native).toContain('audio.getStreamVolume(AudioManager.STREAM_MUSIC) <= 0');
  expect(native).toContain('notifications.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL');
  for (const mode of ['MODE_IN_CALL', 'MODE_IN_COMMUNICATION', 'MODE_RINGTONE']) expect(blocked).toContain(`audio.mode == AudioManager.${mode}`);
  expect(blocked).toContain('return "call_active"');
  for (const sound of ['countdown_yue_halfway.wav', 'countdown_yue_complete.wav', 'countdown_en_halfway.wav', 'countdown_en_complete.wav']) expect(native).toContain(`"${sound}"`);
  expect(native).not.toContain('countdown_chime_');
  expect(native).toContain('AudioAttributes.CONTENT_TYPE_SPEECH');
  expect(native).toContain('it.isNotEmpty() && it !in permittedSounds');
  expect(native).toContain('resources.openRawResourceFd(source)');
  expect(native).not.toMatch(/https?:\/\/|setBypassDnd/);
});

test('user-started media FGS does not depend on notification permission and never opens a permissions screen', () => {
  const start = native.slice(native.indexOf('fun start(context:'), native.indexOf('fun attach('));
  expect(start).not.toMatch(/mayNotify|prepareNotificationChannel|POST_NOTIFICATIONS|requestPermissions|startActivity/);
  expect(start).toContain('if (!options.allowStart || !visible)');
  expect(start).toContain('context.startForegroundService(intent)');
  expect(native).not.toMatch(/requestPermissions|ACTION_APP_NOTIFICATION_SETTINGS|ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS/);
});

test('FGS always submits its required notification while ordinary posting still honours permission and channel denial', () => {
  const update = bridge.slice(bridge.indexOf('fun update(context:'), bridge.indexOf('private fun existingChannel('));
  expect(update).toContain('var notificationsEnabled = (Build.VERSION.SDK_INT < 33 ||');
  expect(update).toContain('context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED');
  expect(update).toContain('if (service == null && !notificationsEnabled)');
  expect(update).toContain('if (channel.importance == NotificationManager.IMPORTANCE_NONE) {\n        notificationsEnabled = false\n        if (service == null) {');
  expect(update).toContain('service.startForeground(foregroundId, builder.build(), type)');
  expect(update).not.toMatch(/deleteNotificationChannel|setBypassDnd|setImportance|requestPermissions/);
  expect(update).toContain('val notificationState = if (notificationsEnabled) "updated" else "denied"');
  expect(update).toContain('"status" to "updated", "notificationStatus" to notificationState');
  expect(update).toContain('"notificationsEnabled" to notificationsEnabled');
});

test('audio ownership and actual notification visibility are separate status fields', () => {
  const status = native.slice(native.indexOf('fun status(context:'), native.indexOf('fun start(context:'));
  expect(status).toContain('val notification = TimerNotificationController.getStatus(context)');
  expect(status).toContain('"status" to if (current.finishing) "finishing" else "updated", "audioOwned" to true');
  expect(status).toContain('"notificationStatus" to (notification["status"] ?: "unavailable")');
  expect(status).toContain('"notificationsEnabled" to (notification["status"] != "denied")');
  expect(status).not.toMatch(/startActivity|requestPermissions|\.notify\(|\.setSound\(/);
});

test('count-up holds no CPU lock; countdown lock is capped at one day plus bounded audio cleanup', () => {
  expect(native).toContain('if (!plan.countdown) return // Count-up renders entirely in System UI.');
  expect(native).toContain('PowerManager.PARTIAL_WAKE_LOCK');
  expect(native).toContain('acquire(remaining.coerceAtMost(86400000L) + 15000L)');
  expect(native).toContain('releasePlayer(); releaseWakeLock()');
  expect(native).toContain('handler.removeCallbacksAndMessages(null)');
  expect(native).toContain('if (wakeLock?.isHeld == true) wakeLock?.release()');
});

test('alarm supplement uses existing exact access without next-alarm UI or automatic service restart', () => {
  expect(native).toContain('if (Build.VERSION.SDK_INT >= 31 && !alarm.canScheduleExactAlarms()) return');
  expect(native).toContain('alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)');
  expect(native).not.toMatch(/setAlarmClock\(|ACTION_REQUEST_SCHEDULE_EXACT_ALARM|startActivity\(/);
  const receiver = native.slice(native.indexOf('fun receive('), native.indexOf('fun armAlarms('));
  expect(receiver).toContain('service?.milestone(phase)');
  expect(receiver).not.toMatch(/startForegroundService|startService|startActivity/);
  expect(native).toContain('return START_NOT_STICKY');
  expect(manifest).not.toContain('BOOT_COMPLETED');
});

test('destruction and stopSelf use current instance/token/startId; diagnostics explain silent outcomes without PII', () => {
  expect(native).toContain('if (service !== instance || plan?.token != token) return');
  expect(native).toContain('stopSelf(lastStartId)');
  expect(native).toContain('TimerAudioServiceController.plan?.token == current?.token');
  const taskRemoved = native.slice(native.indexOf('override fun onTaskRemoved('), native.indexOf('override fun onDestroy()'));
  expect(taskRemoved).toContain('TimerAudioServiceController.service === this && current != null');
  expect(taskRemoved).toContain('TimerAudioServiceController.plan?.token == current?.token');
  expect(native).toContain('mapOf("lastPhase" to lastPhase, "lastCueOutcome" to lastCueOutcome)');
  for (const outcome of ['muted', 'dnd', 'focus_denied', 'source_missing', 'playback_failed', 'late']) expect(native).toContain(`"${outcome}"`);
});

test('countdown deadline callbacks bypass UI sync barriers but remain serialized and nonnegative', () => {
  expect(native).toContain('if (Build.VERSION.SDK_INT >= 28) Handler.createAsync(Looper.getMainLooper())');
  expect(native).toContain('else Handler(Looper.getMainLooper())');
  expect(native).not.toMatch(/HandlerThread|postAtFrontOfQueue|Executors\.|Thread\(/);
  const views = fs.readFileSync(path.join(root, 'java/expo/modules/sessiontimernotification/TimerNotificationViews.kt'), 'utf8');
  expect(views).toContain('val systemClock = options.running && !(nativeCountdown && options.recordMode == "countdown")');
  expect(views).toContain('max(0L, if (countdown) remainingMs else elapsedMs)');
  expect(bridge).toContain('nativeCountdown = countdownRemainingMs != null');
});

test('screen wake and native foreground entry reconcile an overdue deadline without waiting for JS', () => {
  expect(bridge).toContain('TimerAudioServiceController.reconcileDeadline()');
  expect(native).toContain('fun reconcileDeadline() { service?.finishDue() }');
  const observer = native.slice(native.indexOf('private val screenObserver ='), native.indexOf('var finishing:'));
  expect(observer).toContain('Intent.ACTION_SCREEN_ON');
  expect(observer).toContain('Intent.ACTION_USER_PRESENT');
  expect(observer).toContain('finishDue()');
  expect(native).toContain('registerReceiver(screenObserver, filter, Context.RECEIVER_NOT_EXPORTED)');
  const shutdown = native.slice(native.indexOf('fun shutdown('), native.indexOf('override fun onTaskRemoved('));
  expect(shutdown).toContain('unregisterReceiver(screenObserver)');
  expect(shutdown).toContain('screenObserverRegistered = false');
  const finish = native.slice(native.indexOf('fun finishDue('), native.indexOf('private fun blockedReason('));
  expect(finish).toContain('if (finishing) return');
  expect(finish).toContain('if (plan.countdown) milestone("complete")');
});

test('an expired older bridge clock cannot end a replacement timer', () => {
  const expired = native.slice(native.indexOf('if (options.recordMode == "countdown" && options.deadlineAt <='), native.indexOf('val active = service'));
  expect(expired).toContain('if (plan != null && plan?.sameClock(options) != true)');
  expect(expired.indexOf('done(status(context)); return')).toBeLessThan(expired.indexOf('stop(context, preserveDue = true)'));
});

test('native diagnostics are a bounded local snapshot distinguishing delayed callbacks from stale notification posts', () => {
  expect(native).toContain('private var lastNativeDiagnostics: Map<String, Any> = emptyMap()');
  expect(native).toContain('mapOf("nativeDiagnostics" to (service?.diagnosticSnapshot() ?: lastNativeDiagnostics))');
  const diagnostic = native.slice(native.indexOf('fun diagnosticSnapshot():'), native.indexOf('private fun observeScreenWake('));
  for (const field of ['clockRenderer', 'lifecycle', 'remainingMs', 'overdueMs', 'lastNotificationPostAgeMs',
    'notificationPostCount', 'maxGuardDelayMs', 'lastGuardAgeMs', 'completionDelayMs', 'wakeLockHeld', 'screenObserverRegistered']) {
    expect(diagnostic).toContain(`"${field}"`);
  }
  expect(diagnostic).not.toMatch(/timerId|owner|phone|health|name|url|title|body|SharedPreferences|Log\.|https?:/);
  expect(native).toContain('completionDelayMs = max(0L, now - at)');
  expect(native).toContain('maxGuardDelayMs = max(maxGuardDelayMs, max(0L, now - lastGuardAt - 1000L))');
  expect(native).toContain('lastNativeDiagnostics = instance.diagnosticSnapshot() + mapOf("lifecycle" to "finished"');
  expect(native).toContain('lastNativeDiagnostics = emptyMap()');
  expect(native).toContain('"snapshotFrozen" to true, "wakeLockHeld" to false, "screenObserverRegistered" to false');
  const status = native.slice(native.indexOf('fun status(context:'), native.indexOf('fun start(context:'));
  expect(status).toContain('diagnostic()');
  expect(status).not.toMatch(/reconcileDeadline\(|finishDue\(|milestone\(/);
  const bridgeStatus = bridge.slice(bridge.indexOf('AsyncFunction("getTimerAudioServiceStatusAsync")'), bridge.indexOf('internal object TimerNotificationController'));
  expect(bridgeStatus).toContain('TimerAudioServiceController.status(context)');
});
