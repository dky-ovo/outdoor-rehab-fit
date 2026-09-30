package expo.modules.sessiontimernotification

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID
import kotlin.math.roundToLong

class CountdownReminderOptions : Record {
  @Field var timerId: String = ""
  @Field var key: String = ""
  @Field var deadlineAt: Double = 0.0
  @Field var halfwayAt: Double = 0.0
  @Field var locale: String = "zh"
  @Field var title: String = ""
  @Field var halfwayBody: String = ""
  @Field var completeBody: String = ""
  @Field var halfwayChannel: String = ""
  @Field var completeChannel: String = ""
  @Field var halfwaySound: String = ""
  @Field var completeSound: String = ""
}

/** One private, persistent alarm pair. Delivery never initializes React Native. */
class CountdownReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != CountdownReminderController.ACTION) return
    CountdownReminderController.deliver(context, intent)
  }
}

internal object CountdownReminderController {
  const val ACTION = "expo.modules.sessiontimernotification.COUNTDOWN_REMINDER"
  private const val PREFERENCES = "outdoor-fit-native-countdown-reminders"
  private const val TAG = "outdoor-fit-countdown-reminder"
  private const val HALFWAY_ID = 741095
  private const val COMPLETE_ID = 741096
  private const val OPEN_ID = 741097
  // Exact alarm dispatch may cold-start our process on lower-powered phones.
  // Allow a short native delivery window, not a replay after minutes of sleep.
  // Foreground JS speech keeps its stricter two-second window.
  private const val MAX_LATENESS_MS = 10000L
  private val phases = listOf("halfway", "complete")
  @Volatile private var activityForeground = false
  private var scheduledInThisProcessKey: String? = null

  fun setActivityForeground(foreground: Boolean) { activityForeground = foreground }
  fun isActivityForeground(): Boolean = activityForeground

  private fun prefs(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  private fun alarmManager(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
  private fun notificationManager(context: Context) = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  private fun id(phase: String) = if (phase == "halfway") HALFWAY_ID else COMPLETE_ID
  private fun baseIntent(context: Context, phase: String) = Intent(context, CountdownReminderReceiver::class.java)
    .setAction(ACTION).setData(Uri.parse("outdoor-fit-countdown://$phase"))

  private fun pending(context: Context, phase: String): PendingIntent? = PendingIntent.getBroadcast(
    context, id(phase), baseIntent(context, phase), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
  )

  private fun cancelAlarm(context: Context, phase: String) {
    pending(context, phase)?.let { alarmManager(context).cancel(it); it.cancel() }
  }

  private fun mayNotify(context: Context): Boolean =
    (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED)
      && notificationManager(context).areNotificationsEnabled()

  private fun openIntent(context: Context, timerId: String): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.action = Intent.ACTION_VIEW
    launch.data = Uri.Builder().scheme("myapp").authority("timer-notification")
      .appendQueryParameter("timerId", timerId).appendQueryParameter("recordMode", "countdown").build()
    launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(context, OPEN_ID, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  @Synchronized
  fun schedule(context: Context, options: CountdownReminderOptions): Map<String, Any> {
    val now = System.currentTimeMillis()
    if (options.timerId.isBlank() || options.timerId.length > 200 || options.key.isBlank() ||
      !options.deadlineAt.isFinite() || options.deadlineAt !in 1.0..9007199254740991.0 ||
      !options.halfwayAt.isFinite() || options.halfwayAt !in 0.0..options.deadlineAt ||
      !options.halfwayChannel.startsWith("countdown-reminders-v1") ||
      !options.completeChannel.startsWith("countdown-reminders-v1")) return mapOf("status" to "invalid")
    if (!mayNotify(context)) { clear(context); return mapOf("status" to "denied") }
    val deadline = options.deadlineAt.roundToLong()
    if (deadline <= now) { clear(context, preserveDue = true); return mapOf("status" to "expired") }
    val store = prefs(context)
    val alarm = alarmManager(context)
    val exactAllowed = Build.VERSION.SDK_INT < 31 || alarm.canScheduleExactAlarms()
    val sameClock = store.getString("timerId", null) == options.timerId && store.getLong("completeAt", 0L) == deadline
    val samePlan = sameClock && store.getString("key", null) == options.key &&
      store.getBoolean("exactAlarmsAllowed", !exactAllowed) == exactAllowed
    val fired = phases.associateWith { sameClock && store.getBoolean("${it}Delivered", false) }
    if (!samePlan) {
      clear(context)
      // commit before arming: a receiver from an abandoned/resumed clock cannot
      // show a notice even when the process is killed between these operations.
      val persisted = store.edit().putString("token", UUID.randomUUID().toString()).putString("timerId", options.timerId)
        .putString("key", options.key).putLong("halfwayAt", options.halfwayAt.roundToLong()).putLong("completeAt", deadline)
        .putBoolean("exactAlarmsAllowed", exactAllowed)
        .putString("title", options.title.take(200))
        .putString("halfwayBody", options.halfwayBody.take(1000)).putString("completeBody", options.completeBody.take(1000))
        .putString("halfwayChannel", options.halfwayChannel).putString("completeChannel", options.completeChannel)
        .putString("halfwaySound", options.halfwaySound).putString("completeSound", options.completeSound)
        .putBoolean("halfwayDelivered", fired["halfway"] == true).putBoolean("completeDelivered", fired["complete"] == true)
        .commit()
      if (!persisted) { clear(context); return mapOf("status" to "failed") }
    }
    val open = openIntent(context, options.timerId) ?: return mapOf("status" to "unavailable")
    return try {
      for (phase in phases) {
        val at = store.getLong("${phase}At", 0L)
        if (at <= System.currentTimeMillis() || store.getBoolean("${phase}Delivered", false)) continue
        // Reopening the shade / app must not shift deadlines or replay a phase.
        // A PendingIntent alone is not proof the alarm survived an OS process
        // restart/force-stop. First foreground scheduling in a new process
        // re-arms only future phases at their unchanged absolute deadlines.
        if (samePlan && scheduledInThisProcessKey == options.key && pending(context, phase) != null) continue
        val operation = PendingIntent.getBroadcast(context, id(phase), baseIntent(context, phase)
          .putExtra("phase", phase).putExtra("token", store.getString("token", null)).putExtra("at", at),
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (exactAllowed) {
          // A user-started visible timer is an alarm-clock use case. Unlike
          // setExactAndAllowWhileIdle, this API does not share Doze's 9-minute
          // quota between the requested half-time and completion reminders.
          // Android may display its next-alarm icon; no full-screen launch.
          alarm.setAlarmClock(AlarmManager.AlarmClockInfo(at, open), operation)
        } else {
          // No privilege bypass: the UI explains that timing may be delayed.
          alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, operation)
        }
      }
      scheduledInThisProcessKey = options.key
      mapOf("status" to "scheduled", "exactAlarmsAllowed" to exactAllowed)
    } catch (_: SecurityException) {
      clear(context)
      mapOf("status" to "failed", "exactAlarmsAllowed" to false)
    }
  }

  @Synchronized
  fun clear(context: Context, preserveDue: Boolean = false, expiredOnly: Boolean = false): Map<String, Any> {
    val store = prefs(context)
    val now = System.currentTimeMillis()
    if (!preserveDue && !expiredOnly) scheduledInThisProcessKey = null
    val editor = store.edit()
    for (phase in phases) {
      val at = store.getLong("${phase}At", 0L)
      val due = at > 0L && now >= at && now - at <= MAX_LATENESS_MS
      val remove = if (expiredOnly) at > 0L && now - at > MAX_LATENESS_MS else !preserveDue || !due
      if (remove) { cancelAlarm(context, phase); editor.putBoolean("${phase}Delivered", true) }
      if (!preserveDue && !expiredOnly) notificationManager(context).cancel(TAG, id(phase))
    }
    if (!preserveDue && !expiredOnly) editor.clear()
    editor.commit()
    return mapOf("status" to "cleared")
  }

  @Synchronized
  fun deliver(context: Context, intent: Intent) {
    val phase = intent.getStringExtra("phase") ?: return
    if (phase !in phases) return
    val store = prefs(context)
    val at = intent.getLongExtra("at", 0L)
    if (intent.getStringExtra("token") != store.getString("token", null) || at <= 0L ||
      store.getLong("${phase}At", 0L) != at || store.getBoolean("${phase}Delivered", false)) return
    val now = System.currentTimeMillis()
    if (now < at) return
    store.edit().putBoolean("${phase}Delivered", true).commit()
    cancelAlarm(context, phase)
    // No stale sound after waking/unlocking. A late finish remains a silent
    // notice, while an old halfway cue is discarded completely.
    val late = now - at > MAX_LATENESS_MS
    if (late && phase == "halfway" || !mayNotify(context)) return
    val interactive = (context.getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive
    val locked = (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    // Foreground speech owns its cue. Native OS state, not stale JS AppState,
    // decides whether background sound is required.
    if (interactive && !locked && activityForeground) return
    val timerId = store.getString("timerId", null) ?: return
    val open = openIntent(context, timerId) ?: return
    val manager = notificationManager(context)
    val channelId = store.getString("${phase}Channel", null) ?: return
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channelId)?.importance == NotificationManager.IMPORTANCE_NONE) return
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channelId) else Notification.Builder(context)
    builder.setSmallIcon(R.drawable.session_timer_notification_icon).setContentTitle(store.getString("title", ""))
      .setContentText(store.getString("${phase}Body", "")).setStyle(Notification.BigTextStyle().bigText(store.getString("${phase}Body", "")))
      .setContentIntent(open).setCategory(Notification.CATEGORY_ALARM).setVisibility(Notification.VISIBILITY_PUBLIC)
      .setAutoCancel(true).setOnlyAlertOnce(true).setWhen(at).setShowWhen(true)
    if (late && Build.VERSION.SDK_INT >= 26) {
      // A silent child of an app-private group: channel settings remain intact.
      builder.setGroup("outdoor-fit-expired-countdown").setGroupAlertBehavior(Notification.GROUP_ALERT_SUMMARY)
    }
    if (Build.VERSION.SDK_INT < 26) {
      val sound = store.getString("${phase}Sound", "") ?: ""
      val uri = when {
        sound.isBlank() || late -> null
        sound == "default" -> Settings.System.DEFAULT_NOTIFICATION_URI
        else -> context.resources.getIdentifier(sound.substringBeforeLast('.'), "raw", context.packageName)
          .takeIf { it != 0 }?.let { Uri.parse("android.resource://${context.packageName}/$it") }
      }
      @Suppress("DEPRECATION")
      builder.setPriority(Notification.PRIORITY_HIGH).setSound(uri)
    }
    // NotificationManager honours channel sound, ringer/DND and user privacy.
    // Never use MediaPlayer, alarm-stream volume overrides or bypass-DND.
    try { manager.notify(TAG, id(phase), builder.build()) } catch (_: SecurityException) { /* Revoked since scheduling. */ }
  }
}
