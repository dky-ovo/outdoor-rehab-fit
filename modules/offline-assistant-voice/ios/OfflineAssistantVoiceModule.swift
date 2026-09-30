import ExpoModulesCore
import Foundation
import UIKit

/// Reply playback only. The retained module name is compatible with the answer reader.
public class OfflineAssistantVoiceModule: Module {
  private var foreground = true
  private var destroyed = false
  private let speakerLock = NSLock()
  private var speaker: OfflineReplySpeaker?

  public func definition() -> ModuleDefinition {
    Name("OfflineAssistantVoice")
    Events("onReplySpeech")

    AsyncFunction("speakReplyAsync") { (id: String, text: String, lang: String) in
      guard self.foreground, !self.destroyed, UIApplication.shared.applicationState == .active else {
        self.emitSafely(id, "error", "audioBusy")
        return
      }
      self.replySpeaker().speak(id, text, lang)
    }.runOnQueue(.main)
    AsyncFunction("stopReplyAsync") { self.speaker?.stop() }.runOnQueue(.main)
    Function("getReplyStatus") { () -> [String: Any] in
      // Never initialize the synthesizer merely to display diagnostics.
      var value = self.currentSpeaker()?.getStatus() ?? ["status": "idle"]
      value["nativeRevision"] = "reply-only-20260921-r1"
      return value
    }

    OnAppEntersForeground { self.onMain { self.foreground = true } }
    OnAppEntersBackground { self.onMain { self.foreground = false; self.speaker?.stop() } }
    OnDestroy {
      self.onMain {
        self.destroyed = true
        self.foreground = false
        self.speaker?.dispose()
        self.speakerLock.lock()
        self.speaker = nil
        self.speakerLock.unlock()
      }
    }
  }

  private func replySpeaker() -> OfflineReplySpeaker {
    speakerLock.lock()
    defer { speakerLock.unlock() }
    if let speaker = speaker { return speaker }
    let output = OfflineReplySpeaker { [weak self] id, state, error in
      self?.emitSafely(id, state, error)
    }
    speaker = output
    return output
  }

  private func currentSpeaker() -> OfflineReplySpeaker? {
    speakerLock.lock()
    defer { speakerLock.unlock() }
    return speaker
  }

  private func emitSafely(_ id: String, _ status: String, _ errorCode: String?) {
    onMain {
      guard !self.destroyed else { return }
      var value: [String: Any] = ["id": id, "status": status]
      if let errorCode = errorCode { value["errorCode"] = errorCode }
      self.sendEvent("onReplySpeech", value)
    }
  }

  private func onMain(_ body: @escaping () -> Void) {
    if Thread.isMainThread { body() } else { DispatchQueue.main.async(execute: body) }
  }
}
