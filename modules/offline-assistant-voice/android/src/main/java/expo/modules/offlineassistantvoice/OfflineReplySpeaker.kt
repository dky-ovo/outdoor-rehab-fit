package expo.modules.offlineassistantvoice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice

/** Reads replies with installed, non-network voices only. Does not retain or upload text. */
class OfflineReplySpeaker(
  context: Context,
  private val onEvent: (String, String, String?) -> Unit,
) {
  private data class Request(val id: String, val text: String, val language: String)

  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val audioManager = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var engine: TextToSpeech? = null
  private var engineGeneration = 0L
  private var initialized = false
  private var disposed = false
  private var pending: Request? = null
  private var activeId: String? = null
  private var utteranceId: String? = null
  private var nextUtterance = 0L
  private var initTimeout: Runnable? = null
  private var playbackTimeout: Runnable? = null
  private var focusRequest: AudioFocusRequest? = null
  private var focusHeld = false
  private var voiceDiagnostics: Map<String, Any> = emptyMap()
  @Volatile private var snapshot: Map<String, Any> = mapOf("status" to "idle")

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
      main.post { finish("interrupted") }
    }
  }

  fun getStatus(): Map<String, Any> = snapshot.toMap()

  fun speak(id: String, text: String, language: String) {
    runOnMain {
      if (disposed) return@runOnMain
      stopOnMain()
      activeId = id
      voiceDiagnostics = mapOf("requestedLanguage" to language, "voiceConfirmed" to false)
      if (text.isBlank()) { finish("playbackFailed"); return@runOnMain }
      // Android's limit is UTF-16 based. JS splits long answers at sentence boundaries.
      if (text.length > 3500 || text.length >= TextToSpeech.getMaxSpeechInputLength()) {
        finish("inputTooLong"); return@runOnMain
      }
      pending = Request(id, text, language)
      emit(id, "loading")
      if (initialized) speakPending() else initialize()
    }
  }

  private fun runOnMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action()
    else main.post { action() }
  }

  fun stop() {
    if (Looper.myLooper() == Looper.getMainLooper()) stopOnMain()
    else main.post { stopOnMain() }
  }

  fun dispose() {
    main.post {
      if (disposed) return@post
      stopOnMain()
      disposed = true
      engineGeneration += 1
      initTimeout?.let(main::removeCallbacks)
      initTimeout = null
      try { engine?.shutdown() } catch (_: Exception) { }
      engine = null
      initialized = false
    }
  }

  private fun initialize() {
    if (engine != null) return
    val generation = ++engineGeneration
    val timeout = Runnable {
      if (!disposed && generation == engineGeneration && !initialized) failInitialization()
    }
    initTimeout = timeout
    main.postDelayed(timeout, 10000L)
    try {
      engine = TextToSpeech(appContext) { result ->
        // Always post: even a synchronous constructor callback must see the assigned engine.
        main.post {
          if (disposed || generation != engineGeneration) return@post
          initTimeout?.let(main::removeCallbacks)
          initTimeout = null
          if (result != TextToSpeech.SUCCESS || engine == null) {
            failInitialization()
          } else {
            initialized = true
            engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
              override fun onStart(id: String?) = dispatch(id) {
                activeId?.let { emit(it, "speaking") }
                armPlaybackTimeout(id, 420000L)
              }
              override fun onDone(id: String?) = dispatch(id) { finish() }
              @Deprecated("Required by Android TTS")
              override fun onError(id: String?) = dispatch(id) { finish("playbackFailed") }
              override fun onError(id: String?, errorCode: Int) = dispatch(id) { finish("playbackFailed") }
              override fun onStop(id: String?, interrupted: Boolean) = dispatch(id) { finish("interrupted") }
            })
            speakPending()
          }
        }
      }
    } catch (_: Exception) { failInitialization() }
  }

  private fun failInitialization() {
    engineGeneration += 1
    initTimeout?.let(main::removeCallbacks)
    initTimeout = null
    try { engine?.shutdown() } catch (_: Exception) { }
    engine = null
    initialized = false
    finish("voiceUnavailable")
  }

  private fun eligible(voice: Voice, language: String): Boolean {
    return OfflineVoiceSelection.eligible(voice.name, voice.locale?.toLanguageTag(),
      voice.isNetworkConnectionRequired, voice.features?.contains("notInstalled") == true, language)
  }

  private fun confirmedVoice(tts: TextToSpeech, wanted: Voice, language: String): Voice? {
    if (tts.setVoice(wanted) != TextToSpeech.SUCCESS) return null
    val actual = tts.voice ?: return null
    return if (OfflineVoiceSelection.confirmsSelection(wanted.name, wanted.locale?.toLanguageTag(),
      actual.name, actual.locale?.toLanguageTag(), actual.isNetworkConnectionRequired,
      actual.features?.contains("notInstalled") == true, language)) actual else null
  }

  private fun speakPending() {
    val request = pending ?: return
    val tts = engine ?: return
    if (disposed || activeId != request.id) return
    // Clear the sole retained text before calling into the engine. stop() never leaves a queue.
    pending = null
    try {
      voiceDiagnostics = voiceDiagnostics + mapOf("defaultEngine" to (tts.defaultEngine ?: "unknown"))
      val voices = tts.voices?.filter { eligible(it, request.language) }.orEmpty().sortedWith(
        compareByDescending<Voice> { OfflineVoiceSelection.languageRank(it.name, it.locale?.toLanguageTag(), request.language) }
          .thenByDescending { it.quality }.thenBy { it.name })
      val voice = voices.firstNotNullOfOrNull { confirmedVoice(tts, it, request.language) }
      if (voice == null) { finish("voiceUnavailable"); return }
      voiceDiagnostics = voiceDiagnostics + mapOf("selectedVoice" to voice.name,
        "selectedLocale" to voice.locale.toLanguageTag(), "voiceConfirmed" to true, "offline" to true)
      tts.setSpeechRate(0.85f)
      tts.setPitch(1.0f)
      val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
      tts.setAudioAttributes(attributes)
      if (!requestAudioFocus(attributes)) { finish("playbackFailed"); return }
      val token = "outdoor-reply-${++nextUtterance}"
      utteranceId = token
      armPlaybackTimeout(token, 15000L)
      val result = tts.speak(request.text, TextToSpeech.QUEUE_FLUSH, Bundle(), token)
      if (result == TextToSpeech.ERROR) finish("playbackFailed")
    } catch (_: Exception) { finish("playbackFailed") }
  }

  private fun requestAudioFocus(attributes: AudioAttributes): Boolean {
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attributes).setOnAudioFocusChangeListener(focusListener, main)
        .setWillPauseWhenDucked(true).build()
      focusRequest = request
      audioManager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
    }
    focusHeld = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    return focusHeld
  }

  private fun abandonAudioFocus() {
    if (focusHeld) {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          focusRequest?.let(audioManager::abandonAudioFocusRequest)
        } else {
          @Suppress("DEPRECATION")
          audioManager.abandonAudioFocus(focusListener)
        }
      } catch (_: Exception) { }
    }
    focusHeld = false
    focusRequest = null
  }

  private fun dispatch(id: String?, action: () -> Unit) {
    main.post { if (!disposed && id != null && id == utteranceId && activeId != null) action() }
  }

  private fun armPlaybackTimeout(id: String?, duration: Long) {
    playbackTimeout?.let(main::removeCallbacks)
    val timeout = Runnable { if (id != null && id == utteranceId) finish("playbackFailed") }
    playbackTimeout = timeout
    main.postDelayed(timeout, duration)
  }

  private fun stopOnMain() { finish() }

  private fun finish(errorCode: String? = null) {
    val id = activeId
    activeId = null
    pending = null
    utteranceId = null
    playbackTimeout?.let(main::removeCallbacks)
    playbackTimeout = null
    try { engine?.stop() } catch (_: Exception) { }
    abandonAudioFocus()
    if (id != null) emit(id, "idle", errorCode)
    else snapshot = voiceDiagnostics + mapOf("status" to "idle")
  }

  private fun emit(id: String, status: String, errorCode: String? = null) {
    snapshot = voiceDiagnostics.toMutableMap().apply {
      put("id", id)
      put("status", status)
      if (errorCode != null) put("errorCode", errorCode)
    }
    onEvent(id, status, errorCode)
  }
}
