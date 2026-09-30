package expo.modules.sessiontimernotification

import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import java.util.Locale
import kotlin.math.max

/**
 * System-hosted views. Count-up uses a System UI Chronometer. The native
 * countdown service supplies clamped text: RemoteViews cannot attach a tick
 * listener to stop a System UI countdown Chronometer at zero.
 */
internal object TimerNotificationViews {
  fun apply(
    context: Context,
    builder: Notification.Builder,
    options: TimerNotificationOptions,
    elapsedMs: Long,
    remainingMs: Long,
    contentIntent: PendingIntent,
    nativeCountdown: Boolean = false
  ) {
    val countdown = options.recordMode == "countdown"
    // Optional labels keep the UI aligned with the in-app language. The
    // fallback also supports the preceding OTA payload, which had only title.
    val english = options.locale == "en" ||
      (options.locale.isBlank() && options.title.startsWith("Count", ignoreCase = true))
    val mode = options.modeLabel.ifBlank {
      if (english) { if (countdown) "Countdown timer" else "Count-up timer" }
      else { if (countdown) "倒數計時器" else "正數計時器" }
    }.take(100)
    val status = options.statusLabel.ifBlank {
      if (english) { if (options.running) "Running" else "Paused" }
      else { if (options.running) "計時中" else "已暫停" }
    }.take(60)
    val timeLabel = options.timeLabel.ifBlank {
      if (english) { if (countdown) "Remaining" else "Elapsed" }
      else { if (countdown) "剩餘時間" else "已計時間" }
    }.take(80)
    val openLabel = options.openLabel.ifBlank {
      if (english) "Tap to open timer" else "點按返回計時器"
    }.take(160)
    val displayMs = max(0L, if (countdown) remainingMs else elapsedMs)
    val realtime = SystemClock.elapsedRealtime()
    val base = if (countdown) realtime + displayMs else realtime - displayMs
    val compact = create(
      context, R.layout.session_timer_notification_compact, options, mode,
      status, timeLabel, openLabel, base, displayMs, contentIntent, nativeCountdown, expanded = false
    )
    val expanded = create(
      context, R.layout.session_timer_notification_expanded, options, mode,
      status, timeLabel, openLabel, base, displayMs, contentIntent, nativeCountdown, expanded = true
    )

    builder
      // Keep the platform's app identity, expand arrow, accessibility and
      // lockscreen controls; do not supply a fully custom notification shell.
      .setStyle(Notification.DecoratedCustomViewStyle())
      .setCustomContentView(compact)
      .setCustomBigContentView(expanded)
      .setColor(context.getColor(R.color.session_timer_accent))
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      // The large RemoteViews Chronometer is the only visual clock. Hiding the
      // standard header timestamp prevents a second, tiny duplicate timer.
      .setShowWhen(false)
      .setUsesChronometer(false)
      .setSubText(null)
  }

  private fun create(
    context: Context,
    layout: Int,
    options: TimerNotificationOptions,
    mode: String,
    status: String,
    timeLabel: String,
    openLabel: String,
    base: Long,
    displayMs: Long,
    contentIntent: PendingIntent,
    nativeCountdown: Boolean,
    expanded: Boolean
  ): RemoteViews {
    val views = RemoteViews(context.packageName, layout)
    views.setTextViewText(R.id.session_timer_mode, mode)
    views.setTextViewText(R.id.session_timer_status, status)
    views.setOnClickPendingIntent(R.id.session_timer_content, contentIntent)
    views.setContentDescription(R.id.session_timer_mode, mode)
    views.setContentDescription(R.id.session_timer_status, status)
    val systemClock = options.running && !(nativeCountdown && options.recordMode == "countdown")
    views.setViewVisibility(R.id.session_timer_running, if (systemClock) View.VISIBLE else View.GONE)
    views.setViewVisibility(R.id.session_timer_paused, if (systemClock) View.GONE else View.VISIBLE)
    if (systemClock) {
      views.setChronometerCountDown(R.id.session_timer_running, options.recordMode == "countdown")
      views.setChronometer(R.id.session_timer_running, base, null, true)
    } else {
      // A stopped Chronometer re-evaluates its base when RemoteViews is
      // applied. The same styled TextView keeps pause/finish fixed and means
      // a delayed service callback can never display a negative countdown.
      views.setChronometer(R.id.session_timer_running, base, null, false)
      val roundedMs = if (nativeCountdown && options.running) ((displayMs + 999L) / 1000L) * 1000L else displayMs
      views.setTextViewText(R.id.session_timer_paused, formatDuration(roundedMs))
    }
    if (expanded) {
      views.setTextViewText(R.id.session_timer_time_label, timeLabel)
      views.setTextViewText(R.id.session_timer_open, openLabel)
      views.setOnClickPendingIntent(R.id.session_timer_open, contentIntent)
      // The first countdown body line is the deadline; the final line is the
      // existing open hint. Avoid showing the same hint twice in this layout.
      val detail = if (options.running && options.recordMode == "countdown") {
        options.body.lineSequence().firstOrNull().orEmpty().trim().take(250)
      } else ""
      views.setViewVisibility(R.id.session_timer_detail, if (detail.isBlank()) View.GONE else View.VISIBLE)
      views.setTextViewText(R.id.session_timer_detail, detail)
    }
    return views
  }

  private fun formatDuration(milliseconds: Long): String {
    val seconds = max(0L, milliseconds / 1000)
    val hours = seconds / 3600
    return if (hours > 0) String.format(Locale.ROOT, "%d:%02d:%02d", hours, (seconds / 60) % 60, seconds % 60)
    else String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60)
  }
}
