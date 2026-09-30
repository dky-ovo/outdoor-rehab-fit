package expo.modules.offlineassistantvoice

import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Reply playback only. No microphone access, recognition service or model loading. */
class OfflineAssistantVoiceModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var foreground = true
  @Volatile private var destroyed = false
  @Volatile private var speaker: OfflineReplySpeaker? = null

  override fun definition() = ModuleDefinition {
    // Keep the name and reply APIs compatible with the existing answer reader.
    Name("OfflineAssistantVoice")
    Events("onReplySpeech")

    AsyncFunction("speakReplyAsync") { id: String, text: String, lang: String ->
      if (foreground && !destroyed) {
        val output = replySpeaker()
        if (output != null) output.speak(id, text, lang)
        else emitSafely(id, "error", "voiceUnavailable")
      } else emitSafely(id, "error", "audioBusy")
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stopReplyAsync") { speaker?.stop() }.runOnQueue(Queues.MAIN)
    Function("getReplyStatus") {
      (speaker?.getStatus() ?: mapOf("status" to "idle")) + ("nativeRevision" to NATIVE_REVISION)
    }

    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground { foreground = false; onMain { speaker?.stop() } }
    OnActivityDestroys { foreground = false; onMain { speaker?.stop() } }
    OnDestroy {
      destroyed = true
      foreground = false
      onMain { speaker?.dispose(); speaker = null }
    }
  }

  // Created only by speakReplyAsync on MAIN. Status snapshots are safe to read
  // without initializing a speech engine or triggering any permissions.
  private fun replySpeaker(): OfflineReplySpeaker? {
    if (speaker == null && !destroyed) {
      appContext.reactContext?.let { context ->
        speaker = OfflineReplySpeaker(context) { id, state, error -> emitSafely(id, state, error) }
      }
    }
    return speaker
  }

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post { action() }
  }

  private fun emitSafely(id: String, status: String, errorCode: String?) {
    if (destroyed) return
    main.post {
      if (destroyed) return@post
      // Runtime disposal may race a TTS callback; do not allow it to crash the
      // Android main thread. Do not suppress unrelated serious VM Errors.
      try { sendEvent("onReplySpeech", mapOf("id" to id, "status" to status, "errorCode" to errorCode)) }
      catch (_: Exception) { }
    }
  }

  companion object {
    private const val NATIVE_REVISION = "reply-only-20260921-r1"
  }
}
