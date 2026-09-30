import ActivityKit
import Foundation
import UIKit

@available(iOS 16.2, *)
@MainActor
final class SessionTimerLiveActivityController {
  static let shared = SessionTimerLiveActivityController()
  private let defaults = UserDefaults.standard
  private let trackedTimerKey = "outdoor-fit.liveActivity.timerId"
  private let trackedActivityKey = "outdoor-fit.liveActivity.activityId"
  private var generation = 0
  private var tail: Task<[String: String], Never>?

  // ActivityKit operations can suspend. Serialize them and invalidate stale work
  // before starting cleanup so a late request cannot recreate a discarded timer.
  func enqueueUpdate(_ options: SessionTimerLiveActivityOptions) -> Task<[String: String], Never> {
    generation += 1
    let request = generation
    let previous = tail
    let operation = Task { @MainActor in
      _ = await previous?.value
      guard request == self.generation else { return ["status": "cancelled"] }
      return await self.update(options, request: request)
    }
    tail = operation
    return operation
  }

  func enqueueClear() -> Task<[String: String], Never> {
    generation += 1
    let previous = tail
    let operation = Task { @MainActor in
      _ = await previous?.value
      await self.endAll()
      return ["status": "cleared"]
    }
    tail = operation
    return operation
  }

  private func update(_ options: SessionTimerLiveActivityOptions, request: Int) async -> [String: String] {
    guard valid(options) else { return ["status": "invalid"] }
    let now = Date()
    let elapsed = options.accumulatedSeconds + (options.running ? max(0, now.timeIntervalSince1970 - options.startedAt / 1000) : 0)
    if options.recordMode == "countdown" && elapsed >= options.targetDurationSec {
      await endAll()
      return ["status": "expired"]
    }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else {
      await endAll()
      return ["status": "denied"]
    }

    let attributes = OutdoorFitTimerAttributes(timerId: options.timerId, recordMode: options.recordMode, url: options.url)
    let state = contentState(options)
    let content = ActivityContent(state: state,
      staleDate: options.running && options.recordMode == "countdown" ? state.endDate : nil,
      relevanceScore: 80)
    let activities = Activity<OutdoorFitTimerAttributes>.activities
    let matching = activities.first { $0.attributes.timerId == options.timerId && $0.attributes.recordMode == options.recordMode }

    for activity in activities where activity.id != matching?.id {
      await activity.end(activity.content, dismissalPolicy: .immediate)
      guard request == generation else { return ["status": "cancelled"] }
    }

    if let activity = matching {
      if activity.activityState == .dismissed || activity.activityState == .ended {
        remember(activity)
        return ["status": "suppressed"]
      }
      remember(activity)
      // Foreground transitions verify existence without consuming update budget.
      if activity.content.state != state {
        await activity.update(content)
      }
      guard request == generation else { return ["status": "cancelled"] }
      return ["status": "updated"]
    }

    // A person (or the OS's activity lifetime limit) removed this timer. Do not
    // recreate it every time the app becomes active, even after process restart.
    if defaults.string(forKey: trackedTimerKey) == options.timerId {
      return ["status": "suppressed"]
    }
    guard request == generation else { return ["status": "cancelled"] }
    // No push token / background-start entitlement is requested. A normal local
    // Live Activity must be created while the app is visibly in the foreground.
    guard UIApplication.shared.applicationState == .active else { return ["status": "deferred"] }

    do {
      let activity = try Activity<OutdoorFitTimerAttributes>.request(attributes: attributes, content: content, pushType: nil)
      remember(activity)
      return ["status": "updated"]
    } catch {
      return ["status": ActivityAuthorizationInfo().areActivitiesEnabled ? "failed" : "denied"]
    }
  }

  private func remember(_ activity: Activity<OutdoorFitTimerAttributes>) {
    defaults.set(activity.attributes.timerId, forKey: trackedTimerKey)
    defaults.set(activity.id, forKey: trackedActivityKey)
  }

  private func endAll() async {
    for activity in Activity<OutdoorFitTimerAttributes>.activities {
      await activity.end(activity.content, dismissalPolicy: .immediate)
    }
    defaults.removeObject(forKey: trackedTimerKey)
    defaults.removeObject(forKey: trackedActivityKey)
  }

  private func contentState(_ options: SessionTimerLiveActivityOptions) -> OutdoorFitTimerAttributes.ContentState {
    let english = options.locale == "en"
    let countdown = options.recordMode == "countdown"
    let mode = english ? (countdown ? "Countdown timer" : "Count-up timer") : (countdown ? "倒數計時器" : "正數計時器")
    let status = english ? (options.running ? "Running" : "Paused") : (options.running ? "計時中" : "已暫停")
    let time = english ? (countdown ? "Remaining" : "Elapsed") : (countdown ? "剩餘時間" : "已計時間")
    func label(_ value: String, _ fallback: String) -> String { String((value.isEmpty ? fallback : value).prefix(60)) }
    return OutdoorFitTimerAttributes.ContentState(
      running: options.running,
      // Subtract past active periods: a resumed timer continues from its saved
      // elapsed duration without counting time spent paused.
      anchorDate: options.running ? Date(timeIntervalSince1970: options.startedAt / 1000 - options.accumulatedSeconds) : Date(timeIntervalSince1970: 0),
      accumulatedSeconds: options.accumulatedSeconds,
      targetDurationSec: options.targetDurationSec,
      locale: english ? "en" : "zh",
      modeLabel: label(options.modeLabel, mode),
      statusLabel: label(options.statusLabel, status),
      timeLabel: label(options.timeLabel, time),
      openLabel: label(options.openLabel, english ? "Open timer" : "返回計時器"),
      finishedLabel: label(options.finishedLabel, english ? "Finished" : "已結束"))
  }

  private func valid(_ options: SessionTimerLiveActivityOptions) -> Bool {
    guard !options.timerId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, options.timerId.count <= 200,
      ["countup", "countdown"].contains(options.recordMode),
      options.startedAt.isFinite, (0...9007199254740991).contains(options.startedAt),
      !options.running || options.startedAt > 0,
      options.accumulatedSeconds.isFinite, (0...31536000).contains(options.accumulatedSeconds),
      options.targetDurationSec.isFinite, (0...31536000).contains(options.targetDurationSec),
      options.recordMode != "countdown" || options.targetDurationSec > 0,
      options.url.utf8.count < 1500,
      let components = URLComponents(string: options.url), components.scheme == "myapp", components.host == "timer-notification",
      components.user == nil, components.password == nil, components.port == nil, components.fragment == nil,
      components.path.isEmpty || components.path == "/" else { return false }
    let query = components.queryItems ?? []
    return query.filter { $0.name == "timerId" }.count == 1 && query.filter { $0.name == "recordMode" }.count == 1
      && query.first { $0.name == "timerId" }?.value == options.timerId
      && query.first { $0.name == "recordMode" }?.value == options.recordMode
  }
}
