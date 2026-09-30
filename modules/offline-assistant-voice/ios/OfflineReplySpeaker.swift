import AVFoundation
import Foundation
import UIKit

/// Reads only with voices already enumerated by iOS. Never downloads a voice or uploads text.
final class OfflineReplySpeaker: NSObject, AVSpeechSynthesizerDelegate {
  private let onEvent: (String, String, String?) -> Void
  private let synthesizer = AVSpeechSynthesizer()
  private var activeId: String?
  private var activeUtterance: AVSpeechUtterance?
  private var ownsAudioSession = false
  private var disposed = false
  private var timeout: DispatchWorkItem?
  private var observers: [NSObjectProtocol] = []
  private let statusLock = NSLock()
  private var snapshot: [String: Any] = ["status": "idle"]
  private var voiceDiagnostics: [String: Any] = [:]

  init(onEvent: @escaping (String, String, String?) -> Void) {
    self.onEvent = onEvent
    super.init()
    synthesizer.delegate = self
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
    ) { [weak self] _ in self?.finish(errorCode: "interrupted") })
    observers.append(NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: .main
    ) { [weak self] notification in
      let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      if type == AVAudioSession.InterruptionType.began.rawValue { self?.finish(errorCode: "interrupted") }
    })
  }

  deinit {
    timeout?.cancel()
    observers.forEach(NotificationCenter.default.removeObserver)
    synthesizer.delegate = nil
    synthesizer.stopSpeaking(at: .immediate)
    if ownsAudioSession {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
  }

  func getStatus() -> [String: Any] {
    statusLock.lock()
    defer { statusLock.unlock() }
    return snapshot
  }

  func speak(_ id: String, _ text: String, _ language: String) {
    runOnMain { [weak self] in
      guard let self = self, !self.disposed else { return }
      self.stopOnMain()
      self.activeId = id
      self.voiceDiagnostics = ["requestedLanguage": language, "voiceConfirmed": false, "defaultEngine": "Apple AVSpeechSynthesizer"]
      guard UIApplication.shared.applicationState == .active else {
        self.finish(errorCode: "interrupted"); return
      }
      guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        self.finish(errorCode: "playbackFailed"); return
      }
      guard text.utf16.count <= 3500 else { self.finish(errorCode: "inputTooLong"); return }
      self.emit(id, "loading")
      // Do not construct AVSpeechSynthesisVoice(language:), which can select an undesired fallback.
      let voices = AVSpeechSynthesisVoice.speechVoices().filter { self.eligible($0, language) }
      guard let voice = voices.sorted(by: {
        let firstRank = self.languageRank($0, language)
        let secondRank = self.languageRank($1, language)
        if firstRank != secondRank { return firstRank > secondRank }
        if $0.quality.rawValue != $1.quality.rawValue { return $0.quality.rawValue > $1.quality.rawValue }
        return $0.identifier < $1.identifier
      }).first else { self.finish(errorCode: "voiceUnavailable"); return }
      let utterance = AVSpeechUtterance(string: text)
      utterance.voice = voice
      guard let effective = utterance.voice, effective.identifier == voice.identifier,
        effective.language == voice.language, self.eligible(effective, language)
      else { self.finish(errorCode: "voiceUnavailable"); return }
      self.voiceDiagnostics["selectedVoice"] = effective.identifier
      self.voiceDiagnostics["selectedLocale"] = effective.language
      self.voiceDiagnostics["voiceConfirmed"] = true
      self.voiceDiagnostics["offline"] = true
      do {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try session.setActive(true)
        self.ownsAudioSession = true
      } catch { self.finish(errorCode: "playbackFailed"); return }
      utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.85
      utterance.pitchMultiplier = 1.0
      self.activeUtterance = utterance
      self.armTimeout(utterance, seconds: 15)
      self.synthesizer.speak(utterance)
    }
  }

  private func runOnMain(_ action: @escaping () -> Void) {
    if Thread.isMainThread { action() }
    else { DispatchQueue.main.async(execute: action) }
  }

  func stop() {
    if Thread.isMainThread { stopOnMain() }
    else { DispatchQueue.main.async { [weak self] in self?.stopOnMain() } }
  }

  func dispose() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.stopOnMain()
      self.disposed = true
      self.observers.forEach(NotificationCenter.default.removeObserver)
      self.observers.removeAll()
      self.synthesizer.delegate = nil
    }
  }

  private func eligible(_ voice: AVSpeechSynthesisVoice, _ language: String) -> Bool {
    languageRank(voice, language) > 0
  }

  private func languageRank(_ voice: AVSpeechSynthesisVoice, _ language: String) -> Int {
    let requested = language.lowercased()
    let candidate = voice.language.lowercased().replacingOccurrences(of: "_", with: "-")
    if requested == "zh" || requested.hasPrefix("zh-") || requested.hasPrefix("yue") {
      // Apple's enumerated zh-HK voices are Cantonese. Prefer an explicit Yue tag
      // when present; never request a locale fallback through the constructor.
      if candidate == "yue" || candidate.hasPrefix("yue-") { return 2 }
      return candidate == "zh-hk" || candidate == "zh-hant-hk" ? 1 : 0
    }
    return (requested == "en" || requested.hasPrefix("en-")) && (candidate == "en" || candidate.hasPrefix("en-")) ? 1 : 0
  }

  private func armTimeout(_ utterance: AVSpeechUtterance, seconds: TimeInterval) {
    timeout?.cancel()
    let item = DispatchWorkItem { [weak self, weak utterance] in
      guard let self = self, let utterance = utterance, self.activeUtterance === utterance else { return }
      self.finish(errorCode: "playbackFailed")
    }
    timeout = item
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
  }

  private func stopOnMain() { finish() }

  private func finish(errorCode: String? = nil) {
    let id = activeId
    activeId = nil
    activeUtterance = nil
    timeout?.cancel()
    timeout = nil
    synthesizer.stopSpeaking(at: .immediate)
    // The module stops speech on the main queue before configuring microphone capture.
    if ownsAudioSession {
      ownsAudioSession = false
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    if let id = id { emit(id, "idle", errorCode) }
    else {
      statusLock.lock()
      snapshot = voiceDiagnostics.merging(["status": "idle"]) { _, new in new }
      statusLock.unlock()
    }
  }

  private func emit(_ id: String, _ status: String, _ errorCode: String? = nil) {
    var value = voiceDiagnostics
    value["id"] = id
    value["status"] = status
    if let errorCode = errorCode { value["errorCode"] = errorCode }
    statusLock.lock()
    snapshot = value
    statusLock.unlock()
    onEvent(id, status, errorCode)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    guard !disposed, activeUtterance === utterance, let id = activeId else { return }
    emit(id, "speaking")
    armTimeout(utterance, seconds: 420)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    guard !disposed, activeUtterance === utterance else { return }
    finish()
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    guard !disposed, activeUtterance === utterance else { return }
    finish(errorCode: "interrupted")
  }
}
