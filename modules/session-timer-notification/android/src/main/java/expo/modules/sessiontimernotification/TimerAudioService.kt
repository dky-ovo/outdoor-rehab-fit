package expo.modules.sessiontimernotification

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.kotlin.records.Field
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToLong

class TimerAudioOptions : TimerNotificationOptions() {
  @Field var halfwayAt: Double = 0.0
  @Field var deadlineAt: Double = 0.0
  @Field var halfwaySound: String = ""
  @Field var completeSound: String = ""
  @Field var halfwayChannel: String = "countdown-reminders-v1"
  @Field var completeChannel: String = "countdown-reminders-v1"
  @Field var allowStart: Boolean = false
}

internal class TimerAudioPlan(val options: TimerAudioOptions) {
  val token: String = UUID.randomUUID().toString()
  val createdWall: Long = System.currentTimeMillis()
  private val createdElapsed: Long = SystemClock.elapsedRealtime()
  val halfwayElapsed: Long = if (options.halfwayAt > 0) createdElapsed + (options.halfwayAt.roundToLong() - createdWall) else 0L
  val deadlineElapsed: Long = if (options.deadlineAt > 0) createdElapsed + (options.deadlineAt.roundToLong() - createdWall) else 0L
  val claimed = mutableSetOf<String>()
  val countdown: Boolean get() = options.recordMode == "countdown"
  fun sameClock(other: TimerAudioOptions): Boolean = options.timerId == other.timerId && options.recordMode == other.recordMode &&
    options.startedAt == other.startedAt && options.accumulatedSeconds == other.accumulatedSeconds && options.deadlineAt == other.deadlineAt
  fun at(phase: String): Long = if (phase == "halfway") halfwayElapsed else deadlineElapsed
}

/** All entry points, service callbacks and player callbacks run on main. */
internal object TimerAudioServiceController {
  const val ACTION_SYNC = "expo.modules.sessiontimernotification.AUDIO_TIMER_SYNC"
  const val ACTION_ALARM = "expo.modules.sessiontimernotification.AUDIO_TIMER_WAKE"
  const val MAX_LATENESS_MS = 10000L
  private const val MAX_COUNTDOWN_MS = 86400000L
  private const val HALFWAY_REQUEST = 741101
  private const val COMPLETE_REQUEST = 741102
  private val main = Handler(Looper.getMainLooper())
  private val permittedSounds = setOf("countdown_yue_halfway.wav", "countdown_yue_complete.wav",
    "countdown_en_halfway.wav", "countdown_en_complete.wav")
  var plan: TimerAudioPlan? = null
    private set
  var service: TimerAudioService? = null
    private set
  private var waitingToken: String? = null
  private var waiting: ((Map<String, Any>) -> Unit)? = null
  private var lastCueOutcome = "none"
  private var lastPhase = ""
  private var completedTimerId: String? = null
  private var completedDeadline: Double? = null
  // One bounded, in-memory diagnostic snapshot. No user/session identifiers,
  // message text, health records, files or network uploads are recorded here.
  private var lastNativeDiagnostics: Map<String, Any> = emptyMap()

  fun setOutcome(phase: String, outcome: String) { lastPhase = phase; lastCueOutcome = outcome }

  fun diagnostic(): Map<String, Any> = mapOf("lastPhase" to lastPhase, "lastCueOutcome" to lastCueOutcome) +
    (completedTimerId?.let { mapOf("completedTimerId" to it) } ?: emptyMap()) +
    mapOf("nativeDiagnostics" to (service?.diagnosticSnapshot() ?: lastNativeDiagnostics))

  fun reconcileDeadline() { service?.finishDue() }

  fun claimCompletion(current: TimerAudioPlan) {
    if (plan?.token == current.token) {
      completedTimerId = current.options.timerId; completedDeadline = current.options.deadlineAt
    }
  }

  fun legacyNotificationResult(context: Context, timerId: String): Map<String, Any>? {
    // Both bridge paths serialize on main. A delayed ordinary JS notification
    // can neither overwrite the native card nor resurrect the final seconds
    // after native completion has already torn the service down.
    if (service != null) return status(context)
    if (completedTimerId == timerId) return mapOf("status" to "expired", "audioOwned" to true) + diagnostic()
    return null
  }

  fun status(context: Context): Map<String, Any> {
    val current = service
    if (current == null || plan == null) return mapOf("status" to if (completedTimerId != null) "cleared" else "needs_start",
      "audioOwned" to (completedTimerId != null)) + diagnostic()
    val notification = TimerNotificationController.getStatus(context)
    return notification + diagnostic() + mapOf(
      "status" to if (current.finishing) "finishing" else "updated", "audioOwned" to true,
      "running" to !current.finishing, "soundEnabled" to current.soundAvailable(),
      "notificationStatus" to (notification["status"] ?: "unavailable"),
      "notificationsEnabled" to (notification["status"] != "denied"))
  }

  fun start(context: Context, options: TimerAudioOptions, visible: Boolean, done: (Map<String, Any>) -> Unit) {
    if (!valid(options)) { stop(context); done(mapOf("status" to "invalid", "audioOwned" to false)); return }
    if (!options.running) {
      stop(context)
      val result = TimerNotificationController.update(context, options)
      done(result + mapOf("running" to false, "audioOwned" to false) + diagnostic())
      return
    }
    if (options.recordMode == "countdown" && options.deadlineAt <= System.currentTimeMillis()) {
      if (plan != null && plan?.sameClock(options) != true) {
        // A stale, expired bridge snapshot cannot finish a newly started clock.
        done(status(context)); return
      }
      if (completedTimerId == options.timerId && completedDeadline == options.deadlineAt) {
        done(mapOf("status" to "cleared", "audioOwned" to true) + diagnostic())
        return
      }
      val result = stop(context, preserveDue = true)
      done(result)
      return
    }
    val active = service
    val existing = plan
    if (active != null && existing?.sameClock(options) == true && !active.finishing) {
      // Do not rebuild deadlines/player when APP state or card text refreshes.
      existing.options.title = options.title; existing.options.body = options.body
      existing.options.statusLabel = options.statusLabel; existing.options.locale = options.locale
      existing.options.modeLabel = options.modeLabel; existing.options.timeLabel = options.timeLabel
      existing.options.openLabel = options.openLabel; existing.options.finishedLabel = options.finishedLabel
      existing.options.channelName = options.channelName
      existing.options.halfwaySound = options.halfwaySound; existing.options.completeSound = options.completeSound
      existing.options.halfwayChannel = options.halfwayChannel; existing.options.completeChannel = options.completeChannel
      val result = active.refresh()
      if (result["status"] != "updated") stop(context)
      done(result)
      return
    }
    // Starting/replacing a service is tied to a visible user start/resume. A
    // restored JS clock does not silently relaunch background playback.
    if (!options.allowStart || !visible) {
      stop(context)
      done(mapOf("status" to "needs_start", "audioOwned" to false) + diagnostic())
      return
    }
    stop(context)
    CountdownReminderController.clear(context)
    val next = TimerAudioPlan(options)
    lastPhase = ""; lastCueOutcome = "none"
    lastNativeDiagnostics = emptyMap()
    plan = next
    waitingToken = next.token; waiting = done
    try {
      val intent = Intent(context, TimerAudioService::class.java).setAction(ACTION_SYNC).putExtra("token", next.token)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      main.postDelayed({
        if (waitingToken == next.token) {
          setOutcome("", "start_failed")
          stop(context)
        }
      }, 4000L)
    } catch (_: Exception) {
      setOutcome("", "start_failed")
      stop(context)
    }
  }

  fun attach(instance: TimerAudioService, token: String?): TimerAudioPlan? {
    val current = plan ?: return null
    if (token == null || current.token != token) return null
    service = instance
    return current
  }

  fun ready(token: String, result: Map<String, Any>) {
    if (waitingToken != token) return
    val callback = waiting
    waitingToken = null; waiting = null
    callback?.invoke(result + diagnostic())
  }

  fun detached(instance: TimerAudioService) {
    if (service !== instance) return
    service = null
  }

  fun stop(context: Context, preserveDue: Boolean = false): Map<String, Any> {
    val current = service
    val active = plan
    if (preserveDue && current != null && active?.countdown == true) {
      val late = SystemClock.elapsedRealtime() - active.deadlineElapsed
      if (current.finishing || late in 0..MAX_LATENESS_MS) {
        current.finishDue()
        return mapOf("status" to if (service === current) "finishing" else "cleared", "audioOwned" to true) + diagnostic()
      }
    }
    if (preserveDue && current == null && completedTimerId != null) {
      // Native already claimed completion, including muted/focus-denied cues.
      // A late JS summary sync must not play a second foreground TTS copy.
      return mapOf("status" to "cleared", "audioOwned" to true) + diagnostic()
    }
    if (!preserveDue) { completedTimerId = null; completedDeadline = null }
    plan = null
    cancelAlarms(context)
    val callback = waiting
    waiting = null; waitingToken = null
    service = null
    if (current != null) lastNativeDiagnostics = current.diagnosticSnapshot() +
      mapOf("lifecycle" to "stopped", "stopReason" to if (preserveDue) "expired_cleanup" else "explicit_or_failed_stop",
        "snapshotFrozen" to true, "wakeLockHeld" to false, "screenObserverRegistered" to false)
    current?.shutdown()
    context.stopService(Intent(context, TimerAudioService::class.java))
    TimerNotificationController.clear(context)
    callback?.invoke(mapOf("status" to "failed", "audioOwned" to false) + diagnostic())
    return mapOf("status" to "cleared", "audioOwned" to false) + diagnostic()
  }

  fun finish(instance: TimerAudioService, token: String) {
    if (service !== instance || plan?.token != token) return
    plan = null; service = null
    lastNativeDiagnostics = instance.diagnosticSnapshot() + mapOf("lifecycle" to "finished", "stopReason" to "completion",
      "snapshotFrozen" to true, "wakeLockHeld" to false, "screenObserverRegistered" to false)
    cancelAlarms(instance)
    instance.shutdown()
    TimerNotificationController.clear(instance)
  }

  fun receive(context: Context, intent: Intent) {
    val current = plan ?: return
    if (intent.action != ACTION_ALARM || intent.getStringExtra("token") != current.token) return
    val phase = intent.getStringExtra("phase") ?: return
    if (phase !in listOf("halfway", "complete")) return
    // Deliberately no restart from a receiver. Force-stop, system FGS stop,
    // reboot or a killed process require a visible user resume.
    service?.milestone(phase)
  }

  fun armAlarms(context: Context, current: TimerAudioPlan) {
    cancelAlarms(context)
    if (!current.countdown) return
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    if (Build.VERSION.SDK_INT >= 31 && !alarm.canScheduleExactAlarms()) return
    for (phase in listOf("halfway", "complete")) {
      val at = current.at(phase)
      if (at <= SystemClock.elapsedRealtime() || current.claimed.contains(phase)) continue
      val intent = alarmIntent(context, phase).putExtra("token", current.token).putExtra("phase", phase)
      val pending = PendingIntent.getBroadcast(context, requestCode(phase), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      try {
        // Supplemental only: no exact-permission prompt and no next-alarm icon.
        // Android's Doze nine-minute quota still applies; FGS is not an exemption.
        alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending)
      } catch (_: SecurityException) { pending.cancel() }
    }
  }

  private fun requestCode(phase: String) = if (phase == "halfway") HALFWAY_REQUEST else COMPLETE_REQUEST
  private fun alarmIntent(context: Context, phase: String) = Intent(context, TimerAudioAlarmReceiver::class.java)
    .setAction(ACTION_ALARM).setData(Uri.parse("outdoor-fit-timer-audio://$phase"))

  fun cancelAlarms(context: Context) {
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (phase in listOf("halfway", "complete")) {
      val pending = PendingIntent.getBroadcast(context, requestCode(phase), alarmIntent(context, phase),
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE) ?: continue
      alarm.cancel(pending); pending.cancel()
    }
  }

  private fun valid(options: TimerAudioOptions): Boolean {
    if (options.timerId.isBlank() || options.timerId.length > 200 || options.recordMode !in listOf("countup", "countdown") ||
      !options.startedAt.isFinite() || !options.accumulatedSeconds.isFinite() || options.accumulatedSeconds !in 0.0..31536000.0 ||
      !options.targetDurationSec.isFinite() || !options.deadlineAt.isFinite() || !options.halfwayAt.isFinite() ||
      options.halfwayAt < 0 || options.deadlineAt < 0 || options.targetDurationSec < 0 ||
      (options.running && options.startedAt <= 0)) return false
    if (options.recordMode == "countdown" && options.running) {
      val expected = options.startedAt + (options.targetDurationSec - options.accumulatedSeconds) * 1000
      if (options.targetDurationSec <= 0 || options.targetDurationSec * 1000 > MAX_COUNTDOWN_MS ||
        kotlin.math.abs(expected - options.deadlineAt) > 1000 || options.halfwayAt > options.deadlineAt ||
        options.deadlineAt - System.currentTimeMillis() > MAX_COUNTDOWN_MS ||
        listOf(options.halfwaySound, options.completeSound).any { it.isNotEmpty() && it !in permittedSounds } ||
        listOf(options.halfwayChannel, options.completeChannel).any { !it.startsWith("countdown-reminders-v1") }) return false
    }
    return try {
      val uri = Uri.parse(options.url)
      uri.scheme == "myapp" && uri.host == "timer-notification" && uri.port == -1 && uri.userInfo == null &&
        uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/") &&
        uri.getQueryParameter("timerId") == options.timerId && uri.getQueryParameter("recordMode") == options.recordMode
    } catch (_: Exception) { false }
  }
}

class TimerAudioAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) { TimerAudioServiceController.receive(context, intent) }
}

class TimerAudioService : Service() {
  // Still serialized on main, but deadline messages must not wait behind UI
  // synchronization barriers while the Activity is entering/leaving background.
  private val handler = if (Build.VERSION.SDK_INT >= 28) Handler.createAsync(Looper.getMainLooper())
    else Handler(Looper.getMainLooper())
  private var current: TimerAudioPlan? = null
  private var player: MediaPlayer? = null
  private var focusRequest: AudioFocusRequest? = null
  private var legacyFocusListener: AudioManager.OnAudioFocusChangeListener? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var playGeneration = 0
  private var closed = false
  private var lastStartId = 0
  private var playingPhase = ""
  private var countdownTick: Runnable? = null
  private var lastPresentation: List<Any?>? = null
  private var lastPresentationResult: Map<String, Any>? = null
  private var lastForegroundState: List<Any?>? = null
  private var lastNotificationPostAt = 0L
  private var notificationPostCount = 0
  private var lastGuardAt = 0L
  private var maxGuardDelayMs = 0L
  private var completionDelayMs = -1L
  private var screenObserverRegistered = false
  private val screenObserver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == Intent.ACTION_SCREEN_ON || intent.action == Intent.ACTION_USER_PRESENT) finishDue()
    }
  }
  var finishing: Boolean = false
    private set
  private val audio: AudioManager get() = getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    lastStartId = startId
    val plan = TimerAudioServiceController.attach(this, intent?.getStringExtra("token"))
    if (intent?.action != TimerAudioServiceController.ACTION_SYNC || plan == null) {
      // A delayed old start command must not stop the current replacement.
      if (current != null && TimerAudioServiceController.service === this &&
        TimerAudioServiceController.plan?.token == current?.token) return START_NOT_STICKY
      stopSelf(startId)
      return START_NOT_STICKY
    }
    closed = false; current = plan
    lastNotificationPostAt = 0L; notificationPostCount = 0
    lastGuardAt = SystemClock.elapsedRealtime(); maxGuardDelayMs = 0L; completionDelayMs = -1L
    finishing = plan.countdown && SystemClock.elapsedRealtime() >= plan.deadlineElapsed
    val result = refresh()
    if (result["status"] != "updated") {
      TimerAudioServiceController.ready(plan.token, result + mapOf("audioOwned" to false))
      TimerAudioServiceController.stop(this)
      return START_NOT_STICKY
    }
    TimerAudioServiceController.ready(plan.token, result)
    if (plan.countdown) {
      holdCountdownWakeLock(plan)
      observeScreenWake()
      TimerAudioServiceController.armAlarms(this, plan)
      queueMilestone(plan, "halfway"); queueMilestone(plan, "complete")
      queueCountdownUpdate(plan)
    }
    // No restart after OS/user stop; no restoration from an old sticky intent.
    return START_NOT_STICKY
  }

  private fun presentation(remaining: Long?): TimerNotificationOptions? {
    val plan = current ?: return null
    val source = plan.options
    if (!finishing && remaining != 0L) return source
    return TimerNotificationOptions().apply {
      timerId = source.timerId; recordMode = source.recordMode; running = false
      startedAt = 0.0; accumulatedSeconds = source.targetDurationSec; targetDurationSec = source.targetDurationSec
      title = "${source.modeLabel} · ${source.finishedLabel}"; body = source.body; url = source.url; channelName = source.channelName
      locale = source.locale; modeLabel = source.modeLabel; statusLabel = source.finishedLabel
      timeLabel = source.timeLabel; openLabel = source.openLabel; finishedLabel = source.finishedLabel
    }
  }

  fun refresh(): Map<String, Any> {
    val remaining = current?.takeIf { it.countdown }?.let {
      max(0L, it.deadlineElapsed - SystemClock.elapsedRealtime())
    }
    val options = presentation(remaining) ?: return mapOf("status" to "needs_start", "audioOwned" to false)
    // A refresh that crosses the deadline freezes zero too. Let the queued
    // completion claim own audio; do not clear/stop it as an expired update.
    val ended = finishing || remaining == 0L
    val mediaPlaying = player != null
    val foregroundState = listOf(current?.token, ended, mediaPlaying)
    val presentationKey = foregroundState + listOf(options.title, options.body, options.locale,
      options.modeLabel, options.statusLabel, options.timeLabel, options.openLabel, options.finishedLabel,
      options.channelName, remaining?.let { (it + 999L) / 1000L })
    // A JS refresh, second-boundary tick and player preparation can arrive in
    // one second. Post that unchanged frame only once, but never deduplicate
    // the end transition or the FGS media-type change needed for audio focus.
    if (lastPresentation == presentationKey) {
      lastPresentationResult?.let { return it + TimerAudioServiceController.diagnostic() }
    }
    return try {
      val result = TimerNotificationController.update(this, options, this, mediaPlaying, ended,
        countdownRemainingMs = remaining, updateForeground = lastForegroundState != foregroundState)
      val state = result + mapOf("audioOwned" to (result["status"] == "updated"), "running" to !ended,
        "soundEnabled" to soundAvailable()) + TimerAudioServiceController.diagnostic()
      if (result["status"] == "updated") {
        lastNotificationPostAt = SystemClock.elapsedRealtime(); notificationPostCount += 1
        lastPresentation = presentationKey
        lastPresentationResult = state
        lastForegroundState = foregroundState
      }
      state
    } catch (_: Exception) {
      TimerAudioServiceController.setOutcome("", "start_failed")
      mapOf("status" to "failed", "audioOwned" to false) + TimerAudioServiceController.diagnostic()
    }
  }

  fun soundAvailable(): Boolean = current?.let { !it.countdown || (blockedReason("halfway") == null && blockedReason("complete") == null) } ?: false

  fun diagnosticSnapshot(): Map<String, Any> {
    val now = SystemClock.elapsedRealtime()
    val deadline = current?.takeIf { it.countdown }?.deadlineElapsed
    return mapOf(
      "clockRenderer" to if (current?.countdown == true) "clamped_native_text" else "system_chronometer",
      "lifecycle" to if (closed) "closed" else if (finishing) "finishing" else "running",
      "snapshotFrozen" to false,
      "remainingMs" to (deadline?.let { max(0L, it - now) } ?: 0L),
      "overdueMs" to (deadline?.let { max(0L, now - it) } ?: 0L),
      "lastNotificationPostAgeMs" to if (lastNotificationPostAt > 0L) max(0L, now - lastNotificationPostAt) else -1L,
      "notificationPostCount" to notificationPostCount, "maxGuardDelayMs" to maxGuardDelayMs,
      "lastGuardAgeMs" to if (lastGuardAt > 0L) max(0L, now - lastGuardAt) else -1L,
      "completionDelayMs" to completionDelayMs,
      "wakeLockHeld" to (wakeLock?.isHeld == true), "screenObserverRegistered" to screenObserverRegistered)
  }

  private fun observeScreenWake() {
    if (screenObserverRegistered) return
    try {
      val filter = IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_USER_PRESENT) }
      if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenObserver, filter, Context.RECEIVER_NOT_EXPORTED)
      else { @Suppress("DEPRECATION") registerReceiver(screenObserver, filter) }
      screenObserverRegistered = true
    } catch (_: RuntimeException) { screenObserverRegistered = false }
  }

  private fun queueMilestone(plan: TimerAudioPlan, phase: String) {
    val at = plan.at(phase)
    if (at <= 0 || plan.claimed.contains(phase)) return
    handler.postDelayed({ if (!closed && current?.token == plan.token) milestone(phase) }, max(0L, at - SystemClock.elapsedRealtime()))
  }

  private fun stopCountdownUpdates() {
    countdownTick?.let { handler.removeCallbacks(it) }
    countdownTick = null
  }

  private fun queueCountdownUpdate(plan: TimerAudioPlan) {
    stopCountdownUpdates()
    if (closed || finishing || !plan.countdown || current?.token != plan.token ||
      TimerAudioServiceController.plan?.token != plan.token) return
    val remaining = plan.deadlineElapsed - SystemClock.elapsedRealtime()
    if (remaining <= 0L) { milestone("complete"); return }
    val tick = Runnable {
      countdownTick = null
      if (!closed && !finishing && current?.token == plan.token &&
        TimerAudioServiceController.plan?.token == plan.token) {
        val now = SystemClock.elapsedRealtime()
        maxGuardDelayMs = max(maxGuardDelayMs, max(0L, now - lastGuardAt - 1000L))
        lastGuardAt = now
        if (now >= plan.deadlineElapsed) {
          milestone("complete")
        } else {
          val result = refresh()
          if (result["status"] != "updated") TimerAudioServiceController.stop(this)
          else queueCountdownUpdate(plan)
        }
      }
    }
    countdownTick = tick
    // Check the absolute deadline at most once per second as a second path
    // alongside the exact deadline callback/alarm; never subtract per callback.
    handler.postDelayed(tick, ((remaining - 1L) % 1000L) + 1L)
  }

  private fun holdCountdownWakeLock(plan: TimerAudioPlan) {
    releaseWakeLock()
    if (!plan.countdown) return // Count-up renders entirely in System UI.
    val remaining = plan.deadlineElapsed - SystemClock.elapsedRealtime()
    if (remaining <= 0) return
    try {
      wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OutdoorFit:ExerciseCountdown").apply {
          setReferenceCounted(false)
          // Bounded by the user-selected countdown, never a year-long count-up.
          acquire(remaining.coerceAtMost(86400000L) + 15000L)
        }
    } catch (_: SecurityException) { wakeLock = null }
  }

  private fun releaseWakeLock() {
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: RuntimeException) { }
    wakeLock = null
  }

  fun milestone(phase: String) {
    val plan = current ?: return
    if (closed || TimerAudioServiceController.plan?.token != plan.token || phase !in listOf("halfway", "complete")) return
    val at = plan.at(phase)
    val now = SystemClock.elapsedRealtime()
    if (at <= 0L || now < at || !plan.claimed.add(phase)) return
    if (phase == "complete") {
      completionDelayMs = max(0L, now - at)
      TimerAudioServiceController.claimCompletion(plan)
      finishing = true
      stopCountdownUpdates()
      TimerAudioServiceController.cancelAlarms(this)
      // Do not allow a delayed halfway prepare callback to play over completion.
      releasePlayer()
      lastPresentation = null; lastPresentationResult = null; lastForegroundState = null
      // Freeze the card at zero before audio settings, focus or preparation.
      // The end message may continue playing, but the timer itself has ended.
      val frozen = refresh()
      if (frozen["status"] != "updated") {
        TimerAudioServiceController.finish(this, plan.token)
        return
      }
    }
    val late = now - at > TimerAudioServiceController.MAX_LATENESS_MS ||
      phase == "halfway" && now >= plan.deadlineElapsed
    if (late) {
      TimerAudioServiceController.setOutcome(phase, "late")
      if (phase == "complete") TimerAudioServiceController.finish(this, plan.token)
      return
    }
    val blocked = blockedReason(phase)
    if (blocked != null) {
      TimerAudioServiceController.setOutcome(phase, blocked)
      if (phase == "complete") TimerAudioServiceController.finish(this, plan.token)
      return
    }
    play(phase, plan, at)
  }

  fun finishDue() {
    val plan = current ?: return
    if (finishing) return
    if (plan.countdown) milestone("complete")
  }

  private fun blockedReason(phase: String): String? {
    return try { readBlockedReason(phase) } catch (_: Exception) { "audio_unavailable" }
  }

  private fun readBlockedReason(phase: String): String? {
    val plan = current ?: return "no_session"
    // Bundled speech is app media, not a notification/ringtone. A silent old
    // reminder channel or vibration-only ring mode must not mute STREAM_MUSIC.
    // Never change media volume, route audio around DND, or interrupt a call.
    if (audio.getStreamVolume(AudioManager.STREAM_MUSIC) <= 0) return "muted"
    if (audio.mode == AudioManager.MODE_IN_CALL || audio.mode == AudioManager.MODE_IN_COMMUNICATION ||
      audio.mode == AudioManager.MODE_RINGTONE) return "call_active"
    val notifications = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (notifications.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) return "dnd"
    val sound = if (phase == "halfway") plan.options.halfwaySound else plan.options.completeSound
    if (sound.isBlank()) return "muted"
    return if (resources.getIdentifier(sound.substringBeforeLast('.'), "raw", packageName) == 0) "source_missing" else null
  }

  private fun play(phase: String, plan: TimerAudioPlan, at: Long) {
    releasePlayer()
    val generation = playGeneration
    val sourceName = if (phase == "halfway") plan.options.halfwaySound else plan.options.completeSound
    val source = resources.getIdentifier(sourceName.substringBeforeLast('.'), "raw", packageName)
    val next = try { MediaPlayer() } catch (_: Exception) {
      TimerAudioServiceController.setOutcome(phase, "playback_failed")
      if (phase == "complete") TimerAudioServiceController.finish(this, plan.token)
      return
    }
    player = next; playingPhase = phase
    fun isCurrent(): Boolean = !closed && player === next && playGeneration == generation &&
      current?.token == plan.token && TimerAudioServiceController.plan?.token == plan.token
    fun done(outcome: String) {
      if (!isCurrent()) return
      TimerAudioServiceController.setOutcome(phase, outcome)
      releasePlayer()
      if (phase == "complete") {
        TimerAudioServiceController.finish(this, plan.token)
      } else if (outcome == "start_failed") {
        TimerAudioServiceController.stop(this)
      } else {
        val result = refresh()
        if (result["status"] != "updated") TimerAudioServiceController.stop(this)
      }
    }
    try {
      // Android 15 allows audio focus only after a visible activity or FGS.
      // Add the playback type only for this real short sound, not idle tracking.
      val promoted = refresh()
      if (promoted["status"] != "updated") { done("start_failed"); return }
      val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
      val listener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
          change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) done("focus_lost")
      }
      val granted = if (Build.VERSION.SDK_INT >= 26) {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes)
          .setAcceptsDelayedFocusGain(false).setOnAudioFocusChangeListener(listener, handler).build()
        focusRequest = request
        audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
      } else {
        legacyFocusListener = listener
        @Suppress("DEPRECATION")
        (audio.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
      }
      if (!granted) { done("focus_denied"); return }
      next.setAudioAttributes(attributes)
      next.isLooping = false
      resources.openRawResourceFd(source).use { descriptor ->
        next.setDataSource(descriptor.fileDescriptor, descriptor.startOffset, descriptor.length)
      }
      next.setOnPreparedListener {
        if (!isCurrent()) return@setOnPreparedListener
        // A same-clock locale change updates options without resetting claims.
        // Never start the old language after a delayed prepare callback. An
        // already-playing sentence may finish; the next phase uses new speech.
        val expectedSound = if (phase == "halfway") plan.options.halfwaySound else plan.options.completeSound
        if (sourceName != expectedSound) { done("language_changed"); return@setOnPreparedListener }
        if (SystemClock.elapsedRealtime() - at > TimerAudioServiceController.MAX_LATENESS_MS ||
          phase == "halfway" && SystemClock.elapsedRealtime() >= plan.deadlineElapsed) { done("late"); return@setOnPreparedListener }
        val blocked = blockedReason(phase)
        if (blocked != null) { done(blocked); return@setOnPreparedListener }
        try {
          next.start()
          TimerAudioServiceController.setOutcome(phase, "playing")
        } catch (_: Exception) { done("playback_failed") }
      }
      next.setOnCompletionListener { done("played") }
      next.setOnErrorListener { _, _, _ -> done("playback_failed"); true }
      // No audio engine callback is permitted to keep the service indefinitely.
      handler.postDelayed({ if (isCurrent()) done("playback_timeout") }, 15000L)
      next.prepareAsync()
    } catch (_: Exception) { done("playback_failed") }
  }

  private fun releasePlayer() {
    playGeneration += 1
    val previous = player
    player = null; playingPhase = ""
    if (previous != null) {
      try { previous.setOnPreparedListener(null); previous.setOnCompletionListener(null); previous.setOnErrorListener(null); previous.release() }
      catch (_: RuntimeException) { }
    }
    try {
      if (Build.VERSION.SDK_INT >= 26) focusRequest?.let { audio.abandonAudioFocusRequest(it) }
      else legacyFocusListener?.let { @Suppress("DEPRECATION") audio.abandonAudioFocus(it) }
    } catch (_: RuntimeException) { }
    focusRequest = null; legacyFocusListener = null
  }

  fun shutdown() {
    if (closed) return
    closed = true
    stopCountdownUpdates()
    handler.removeCallbacksAndMessages(null)
    if (screenObserverRegistered) {
      try { unregisterReceiver(screenObserver) } catch (_: IllegalArgumentException) { }
      screenObserverRegistered = false
    }
    releasePlayer(); releaseWakeLock()
    lastPresentation = null; lastPresentationResult = null; lastForegroundState = null
    current = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf(lastStartId)
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    if (TimerAudioServiceController.service === this && current != null &&
      TimerAudioServiceController.plan?.token == current?.token) TimerAudioServiceController.stop(this)
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    // Never let destruction of an old instance clear a replacement timer.
    if (TimerAudioServiceController.service === this) TimerAudioServiceController.finish(this, current?.token ?: "")
    shutdown()
    TimerAudioServiceController.detached(this)
    super.onDestroy()
  }
}
