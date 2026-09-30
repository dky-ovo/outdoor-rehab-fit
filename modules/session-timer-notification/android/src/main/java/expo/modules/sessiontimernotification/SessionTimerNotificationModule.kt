package expo.modules.sessiontimernotification

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToLong

open class TimerNotificationOptions : Record {
  @Field var timerId: String = ""
  @Field var recordMode: String = ""
  @Field var running: Boolean = false
  @Field var startedAt: Double = 0.0
  @Field var accumulatedSeconds: Double = 0.0
  @Field var targetDurationSec: Double = 0.0
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var url: String = ""
  @Field var channelName: String = "Exercise timers"
  @Field var locale: String = ""
  @Field var modeLabel: String = ""
  @Field var statusLabel: String = ""
  @Field var timeLabel: String = ""
  @Field var openLabel: String = ""
  @Field var finishedLabel: String = ""
  @Field var restoreDismissed: Boolean = false
}

class SessionTimerNotificationModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SessionTimerNotification")

    // Native activity events remain timely while JS is suspended. A receiver
    // itself temporarily raises process importance, so importance is not a
    // valid test of whether our timer screen is actually in the foreground.
    OnActivityEntersForeground {
      CountdownReminderController.setActivityForeground(true)
      // Reconcile natively before a suspended JS tree paints an expired timer.
      TimerAudioServiceController.reconcileDeadline()
    }
    OnActivityEntersBackground { CountdownReminderController.setActivityForeground(false) }
    OnActivityDestroys { CountdownReminderController.setActivityForeground(false) }

    AsyncFunction("updateAsync") { options: TimerNotificationOptions ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerAudioServiceController.legacyNotificationResult(context, options.timerId)
        ?: TimerNotificationController.update(context, options)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      // Legacy JS cleanup must not erase the service-owned finishing card or
      // leave active audio running without its foreground notification.
      if (TimerAudioServiceController.service != null) TimerAudioServiceController.status(context)
      else {
        TimerNotificationController.clear(context)
        mapOf("status" to "cleared")
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getStatusAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerNotificationController.getStatus(context)
    }

    AsyncFunction("prepareNotificationChannelAsync") { channelName: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerNotificationController.prepareNotificationChannel(context, channelName)
    }

    AsyncFunction("checkReminderSettingsAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerNotificationController.checkReminderSettings(context)
    }

    // These settings screens are opened only by an explicit in-app action.
    AsyncFunction("openExactAlarmSettingsAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerNotificationController.openExactAlarmSettings(context)
    }

    AsyncFunction("openNotificationSettingsAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerNotificationController.openNotificationSettings(context)
    }

    AsyncFunction("scheduleCountdownRemindersAsync") { options: CountdownReminderOptions ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      CountdownReminderController.schedule(context, options)
    }

    AsyncFunction("clearCountdownRemindersAsync") { preserveDue: Boolean, expiredOnly: Boolean ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      CountdownReminderController.clear(context, preserveDue, expiredOnly)
    }

    AsyncFunction("startTimerAudioServiceAsync") { options: TimerAudioOptions, promise: Promise ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val activity = appContext.currentActivity
      val interactive = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
      val locked = (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
      // Android permission sheets can briefly blur a resumed Activity without
      // taking it out of the foreground. No delayed/background auto-start.
      val visible = activity != null && !activity.isFinishing && !activity.isDestroyed && interactive && !locked &&
        (activity.hasWindowFocus() || CountdownReminderController.isActivityForeground())
      TimerAudioServiceController.start(context, options, visible) { result -> promise.resolve(result) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopTimerAudioServiceAsync") { preserveDue: Boolean ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerAudioServiceController.stop(context, preserveDue)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getTimerAudioServiceStatusAsync") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      TimerAudioServiceController.status(context)
    }.runOnQueue(Queues.MAIN)
  }
}

internal object TimerNotificationController {
  // A dedicated, deterministic ID means state updates replace one notification.
  // This tag/ID never overlaps with expo-notifications' reminder notifications.
  private const val TAG = "outdoor-fit-active-timer"
  private const val NOTIFICATION_ID = 741082
  // The ended card must not be an update to a stale per-second snapshot. Some
  // System UI implementations coalesce those updates while the screen sleeps.
  private const val COMPLETION_NOTIFICATION_ID = 741085
  private const val CONTENT_REQUEST_CODE = 741083
  private const val EXPIRY_REQUEST_CODE = 741084
  private const val CHANNEL_ID = "session-timer-status-v2"
  private const val LEGACY_CHANNEL_ID = "session-timer-status-v1"
  private const val PREFERENCES = "outdoor-fit-active-timer"
  private const val DISPLAY_PREFERENCES = "outdoor-fit-active-timer-display"
  private const val DISMISS_REQUEST_CODE = 741098
  private const val MAX_SECONDS = 31536000.0

  // Expo's Android 13 permission prompt needs an existing channel. Preparation
  // is explicit and does not post a timer or turn a read-only status query into
  // a mutation. Both preparation and posting share the same migration guard.
  @Synchronized
  fun prepareNotificationChannel(context: Context, channelName: String): Map<String, Any> {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return try {
      if (Build.VERSION.SDK_INT >= 26) ensureChannel(manager, channelName)
      notificationStatus(manager, "prepared")
    } catch (_: SecurityException) {
      mapOf("status" to "denied")
    }
  }

  // A foreground recheck must observe the user's notification settings/swipe
  // without posting again, recreating a channel, or changing the timer clock.
  @Synchronized
  fun getStatus(context: Context): Map<String, Any> {
    return try {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= 33 &&
        context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED
      ) return notificationStatus(manager, "denied")
      if (!manager.areNotificationsEnabled()) return notificationStatus(manager, "denied")
      if (Build.VERSION.SDK_INT >= 26 &&
        existingChannel(manager)?.importance == NotificationManager.IMPORTANCE_NONE
      ) return notificationStatus(manager, "denied")
      val visible = manager.activeNotifications.any { (it.tag == TAG || it.tag == null) &&
        (it.id == NOTIFICATION_ID || it.id == COMPLETION_NOTIFICATION_ID) }
      val display = context.getSharedPreferences(DISPLAY_PREFERENCES, Context.MODE_PRIVATE)
      val dismissed = !visible && display.getString("timerId", null) != null &&
        display.getString("timerId", null) == display.getString("dismissedTimerId", null)
      notificationStatus(manager, if (visible) "visible" else if (dismissed) "suppressed" else "missing") +
        mapOf("recoverableMissing" to !dismissed)
    } catch (_: SecurityException) {
      mapOf("status" to "denied")
    }
  }

  @Synchronized
  fun update(context: Context, options: TimerNotificationOptions, service: Service? = null,
    mediaPlaying: Boolean = false, finishing: Boolean = false,
    countdownRemainingMs: Long? = null, updateForeground: Boolean = true): Map<String, Any> {
    if (!isValid(options)) return mapOf("status" to "invalid")
    val display = context.getSharedPreferences(DISPLAY_PREFERENCES, Context.MODE_PRIVATE)
    if (service == null && !options.restoreDismissed && display.getString("dismissedTimerId", null) == options.timerId) {
      return mapOf("status" to "suppressed")
    }

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    var notificationsEnabled = (Build.VERSION.SDK_INT < 33 ||
      context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED) &&
      manager.areNotificationsEnabled()
    // Android 13+ permits a user-started FGS without POST_NOTIFICATIONS. We
    // still supply its required notification; Android controls its visibility.
    // Only ordinary notification posting requires notification authorization.
    if (service == null && !notificationsEnabled) {
      clear(context)
      return notificationStatus(manager, "denied")
    }

    val channelId = if (Build.VERSION.SDK_INT >= 26) {
      val channel = ensureChannel(manager, options.channelName)
      if (channel.importance == NotificationManager.IMPORTANCE_NONE) {
        notificationsEnabled = false
        if (service == null) {
          clear(context)
          return notificationStatus(manager, "denied")
        }
      }
      channel.id
    } else CHANNEL_ID

    val now = System.currentTimeMillis()
    val accumulatedMs = (options.accumulatedSeconds * 1000).roundToLong()
    val elapsedMs = accumulatedMs + if (options.running) max(0L, now - options.startedAt.roundToLong()) else 0L
    val countdown = options.recordMode == "countdown"
    // The service tracks a monotonic deadline. Its display must not jump if
    // Android synchronizes wall time while the countdown is running.
    val remainingMs = countdownRemainingMs?.coerceAtLeast(0L)
      ?: ((options.targetDurationSec * 1000).roundToLong() - elapsedMs)
    if (countdown && remainingMs <= 0L && !finishing) {
      clear(context)
      return mapOf("status" to "expired")
    }

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return mapOf("status" to "unavailable")
    launch.action = Intent.ACTION_VIEW
    launch.data = Uri.parse(options.url)
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val contentIntent = PendingIntent.getActivity(
      context, CONTENT_REQUEST_CODE, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    // Keep the same delete intent and preferences throughout a running phase.
    // A new UUID/write every second needlessly queues binder and disk work.
    val displayPhase = if (finishing) "complete" else if (options.running) "running" else "paused"
    val displayClock = listOf(options.recordMode, options.startedAt, options.accumulatedSeconds,
      options.targetDurationSec).joinToString("|")
    val sameDisplay = display.getString("timerId", null) == options.timerId &&
      display.getString("phase", null) == displayPhase && display.getString("clock", null) == displayClock
    val displayToken = if (sameDisplay) display.getString("displayToken", null) ?: UUID.randomUUID().toString()
      else UUID.randomUUID().toString()
    val dismissIntent = PendingIntent.getBroadcast(context, DISMISS_REQUEST_CODE,
      Intent(context, TimerExpiryReceiver::class.java).setAction("expo.modules.sessiontimernotification.DISMISS")
        .setData(Uri.parse("outdoor-fit-timer-dismiss://$displayToken"))
        .putExtra("timerId", options.timerId).putExtra("displayToken", displayToken),
      PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE)

    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channelId) else Notification.Builder(context)
    builder
      .setSmallIcon(R.drawable.session_timer_notification_icon)
      .setContentTitle(options.title.take(200))
      .setContentText(options.body.take(500))
      .setContentIntent(contentIntent)
      .setDeleteIntent(dismissIntent)
      .setCategory(if (Build.VERSION.SDK_INT >= 31) Notification.CATEGORY_STOPWATCH else Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setAutoCancel(false)
      .setShowWhen(options.running)
      .setUsesChronometer(options.running)
      .setChronometerCountDown(countdown && options.running)
    @Suppress("DEPRECATION")
    if (Build.VERSION.SDK_INT < 26) builder.setPriority(Notification.PRIORITY_DEFAULT).setSound(null).setVibrate(null).setDefaults(0)
    if (Build.VERSION.SDK_INT >= 31 && service != null) {
      builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
    }
    if (Build.VERSION.SDK_INT >= 26 && service != null) {
      // MediaPlayer is the only cue owner. Keep card updates silent even when
      // the user selected a custom status-channel sound, without altering it.
      builder.setGroup("outdoor-fit-audio-timer-status").setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)
    }

    if (options.running) {
      // Android's System UI owns the chronometer and keeps rendering it even
      // when React Native JS is suspended. No per-second JS/background service.
      builder.setWhen(if (countdown) now + remainingMs else now - elapsedMs)
      if (countdown && Build.VERSION.SDK_INT >= 26 && service == null) builder.setTimeoutAfter(remainingMs)
    } else {
      builder.setSubText(formatDuration(if (countdown) remainingMs else elapsedMs))
    }

    TimerNotificationViews.apply(context, builder, options, elapsedMs, remainingMs, contentIntent,
      nativeCountdown = countdownRemainingMs != null)

    try {
      // Update first; only a successfully posted notification changes its expiry.
      if (service == null) {
        manager.notify(TAG, NOTIFICATION_ID, builder.build())
      } else {
        // One visible FGS card. Count-up uses System UI; countdown text is supplied by
        // the native service and cannot run below zero. No silent media loop:
        // idle timer tracking is specialUse, not mediaPlayback.
        if (!sameDisplay) manager.cancel(TAG, NOTIFICATION_ID)
        // Android replaces the old foreground notification when its ID changes.
        // Switch to a fresh fixed-zero card without dropping foreground status:
        // no stale last-seconds update, no background service restart for speech.
        val foregroundId = if (finishing) COMPLETION_NOTIFICATION_ID else NOTIFICATION_ID
        if (!updateForeground) {
          // Same service/type: update its existing card, not its lifecycle.
          // Foreground status is retained by Android for the same tag and ID.
          manager.notify(foregroundId, builder.build())
        } else if (Build.VERSION.SDK_INT >= 34) {
          val type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or
            (if (mediaPlaying) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)
          service.startForeground(foregroundId, builder.build(), type)
        } else if (Build.VERSION.SDK_INT >= 29) {
          service.startForeground(foregroundId, builder.build(),
            if (mediaPlaying) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK else 0)
        } else service.startForeground(foregroundId, builder.build())
        if (finishing) manager.cancel(NOTIFICATION_ID)
      }
      if (!sameDisplay) display.edit().putString("timerId", options.timerId).putString("displayToken", displayToken)
        .putString("phase", displayPhase).putString("clock", displayClock).remove("dismissedTimerId").apply()
      if (service == null || !sameDisplay) cancelExpiry(context)
      if (countdown && options.running && Build.VERSION.SDK_INT < 26 && service == null) {
        saveExpiry(context, options.timerId, now + remainingMs)
        scheduleExpiry(context, options.timerId, remainingMs, now + remainingMs)
      } else if (service == null || !sameDisplay) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().clear().apply()
      }
    } catch (_: SecurityException) {
      clear(context)
      return notificationStatus(manager, "denied")
    }
    // An updated service is not proof that the notification is visible. Never
    // recreate/unmute a user-blocked channel to force it into the drawer.
    val notificationState = if (notificationsEnabled) "updated" else "denied"
    return notificationStatus(manager, notificationState) + mapOf(
      "status" to "updated", "notificationStatus" to notificationState,
      "notificationsEnabled" to notificationsEnabled)
  }

  private fun existingChannel(manager: NotificationManager): NotificationChannel? {
    if (Build.VERSION.SDK_INT < 26) return null
    return manager.getNotificationChannel(CHANNEL_ID) ?: manager.getNotificationChannel(LEGACY_CHANNEL_ID)
  }

  private fun ensureChannel(manager: NotificationManager, channelName: String): NotificationChannel {
    manager.getNotificationChannel(CHANNEL_ID)?.let { return it }
    val legacy = manager.getNotificationChannel(LEGACY_CHANNEL_ID)
    if (legacy != null) {
      // Channel importance cannot be raised after creation. Only migrate the
      // app's untouched LOW default. Keep the actual old channel for every
      // explicit user choice (including hiding lock-screen content), since an
      // app cannot copy the system-owned lockscreenVisibility to a new channel.
      // Android 8/9 cannot reveal user-selected importance, so keep it there.
      val canUpgradeDefault = Build.VERSION.SDK_INT >= 29 &&
        !legacy.hasUserSetImportance() &&
        legacy.importance == NotificationManager.IMPORTANCE_LOW &&
        legacy.lockscreenVisibility != Notification.VISIBILITY_PRIVATE &&
        legacy.lockscreenVisibility != Notification.VISIBILITY_SECRET &&
        !(Build.VERSION.SDK_INT >= 30 && legacy.hasUserSetSound()) &&
        legacy.group == null && legacy.sound == null && !legacy.shouldVibrate() &&
        !legacy.canShowBadge() && !legacy.shouldShowLights()
      if (!canUpgradeDefault) return legacy
    }
    val channel = NotificationChannel(
      CHANNEL_ID, channelName.take(100), NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      // DEFAULT avoids the LOW/silent section hidden on many lock screens;
      // the timer card itself remains quiet on start/pause/resume.
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    manager.createNotificationChannel(channel)
    return manager.getNotificationChannel(CHANNEL_ID) ?: channel
  }

  private fun notificationStatus(manager: NotificationManager, status: String): Map<String, Any> {
    val channel = existingChannel(manager)
    val reason = when {
      status == "denied" -> "notifications_disabled"
      channel == null -> ""
      channel.lockscreenVisibility == Notification.VISIBILITY_SECRET ||
        channel.lockscreenVisibility == Notification.VISIBILITY_PRIVATE -> "channel_privacy"
      channel.importance < NotificationManager.IMPORTANCE_DEFAULT -> "channel_silent"
      else -> ""
    }
    // Presence in activeNotifications does not prove that the lock screen is
    // showing it. Global/OEM lock-screen privacy has no reliable public query.
    return mapOf(
      "status" to status,
      "channelId" to (channel?.id ?: CHANNEL_ID),
      "lockscreenRestricted" to reason.isNotEmpty(),
      "lockscreenReason" to reason
    )
  }

  fun checkReminderSettings(context: Context): Map<String, Any> {
    val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val allowed = Build.VERSION.SDK_INT < 31 || alarmManager.canScheduleExactAlarms()
    return mapOf("status" to "available", "exactAlarmsAllowed" to allowed)
  }

  fun openExactAlarmSettings(context: Context): Map<String, String> {
    if (Build.VERSION.SDK_INT < 31 ||
      (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
    ) return mapOf("status" to "allowed")
    return openSettings(context, Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
      .setData(Uri.parse("package:${context.packageName}")))
  }

  fun openNotificationSettings(context: Context): Map<String, String> {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel = existingChannel(manager)
    val intent = if (Build.VERSION.SDK_INT >= 26 && channel != null) {
      Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .putExtra(Settings.EXTRA_CHANNEL_ID, channel.id)
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.parse("package:${context.packageName}"))
    }
    return openSettings(context, intent)
  }

  private fun openSettings(context: Context, intent: Intent): Map<String, String> {
    return try {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      mapOf("status" to "opened")
    } catch (_: ActivityNotFoundException) {
      mapOf("status" to "unavailable")
    } catch (_: SecurityException) {
      mapOf("status" to "unavailable")
    }
  }

  @Synchronized
  fun clear(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(TAG, NOTIFICATION_ID)
    manager.cancel(NOTIFICATION_ID)
    manager.cancel(COMPLETION_NOTIFICATION_ID)
    cancelExpiry(context)
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().clear().apply()
    context.getSharedPreferences(DISPLAY_PREFERENCES, Context.MODE_PRIVATE).edit().clear().apply()
  }

  @Synchronized
  fun dismissed(context: Context, timerId: String?, displayToken: String?) {
    if (timerId.isNullOrBlank() || displayToken.isNullOrBlank()) return
    val display = context.getSharedPreferences(DISPLAY_PREFERENCES, Context.MODE_PRIVATE)
    if (display.getString("timerId", null) == timerId && display.getString("displayToken", null) == displayToken) {
      display.edit().putString("dismissedTimerId", timerId).apply()
    }
  }

  @Synchronized
  fun expire(context: Context, timerId: String?, deadlineAt: Long) {
    val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    // An old receiver must never remove a newly started/resumed timer. Compare
    // both identity and deadline, including after the app process was recreated.
    if (timerId.isNullOrBlank() || preferences.getString("timerId", null) != timerId ||
      preferences.getLong("deadlineAt", 0L) != deadlineAt || System.currentTimeMillis() < deadlineAt
    ) return
    clear(context)
  }

  private fun isValid(options: TimerNotificationOptions): Boolean {
    if (options.timerId.isBlank() || options.timerId.length > 200 ||
      options.recordMode !in listOf("countdown", "countup") ||
      !options.accumulatedSeconds.isFinite() || options.accumulatedSeconds !in 0.0..MAX_SECONDS ||
      !options.targetDurationSec.isFinite() || options.targetDurationSec !in 0.0..MAX_SECONDS ||
      !options.startedAt.isFinite() || options.startedAt !in 0.0..9007199254740991.0 ||
      (options.running && options.startedAt <= 0.0) ||
      (options.recordMode == "countdown" && options.targetDurationSec <= 0.0)
    ) return false
    return try {
      val uri = Uri.parse(options.url)
      uri.scheme == "myapp" && uri.host == "timer-notification" &&
        uri.port == -1 && uri.userInfo == null &&
        (uri.path.isNullOrEmpty() || uri.path == "/") && uri.fragment == null &&
        uri.getQueryParameter("timerId") == options.timerId &&
        uri.getQueryParameter("recordMode") == options.recordMode
    } catch (_: Exception) {
      false
    }
  }

  private fun formatDuration(milliseconds: Long): String {
    val seconds = max(0L, milliseconds / 1000)
    val hours = seconds / 3600
    return if (hours > 0) String.format(Locale.ROOT, "%d:%02d:%02d", hours, (seconds / 60) % 60, seconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
  }

  private fun saveExpiry(context: Context, timerId: String, deadlineAt: Long) {
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit()
      .putString("timerId", timerId).putLong("deadlineAt", deadlineAt).apply()
  }

  private fun expiryIntent(context: Context): Intent = Intent(context, TimerExpiryReceiver::class.java)
    .setAction("expo.modules.sessiontimernotification.EXPIRE")

  private fun cancelExpiry(context: Context) {
    val pending = PendingIntent.getBroadcast(
      context, EXPIRY_REQUEST_CODE, expiryIntent(context),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
    ) ?: return
    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
    pending.cancel()
  }

  private fun scheduleExpiry(context: Context, timerId: String, remainingMs: Long, deadlineAt: Long) {
    val pending = PendingIntent.getBroadcast(
      context, EXPIRY_REQUEST_CODE,
      expiryIntent(context).putExtra("timerId", timerId).putExtra("deadlineAt", deadlineAt),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    // Only Android 7 needs this silent cleanup fallback. On Android 8+ the
    // system-owned TimeoutAfter handles removal, without consuming an extra
    // app alarm that could delay existing midpoint/end reminders in Doze.
    // This fallback does not request exact-alarm access or promise precision.
    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).setAndAllowWhileIdle(
      AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + remainingMs, pending
    )
  }
}
