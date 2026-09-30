import ExpoModulesCore

struct SessionTimerLiveActivityOptions: Record {
  @Field var timerId: String = ""
  @Field var recordMode: String = ""
  @Field var running: Bool = false
  @Field var startedAt: Double = 0
  @Field var accumulatedSeconds: Double = 0
  @Field var targetDurationSec: Double = 0
  @Field var title: String = ""
  @Field var body: String = ""
  @Field var url: String = ""
  @Field var channelName: String = ""
  @Field var locale: String = "zh"
  @Field var modeLabel: String = ""
  @Field var statusLabel: String = ""
  @Field var timeLabel: String = ""
  @Field var openLabel: String = ""
  @Field var finishedLabel: String = ""
}

public class SessionTimerNotificationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SessionTimerNotification")

    AsyncFunction("updateAsync") { (options: SessionTimerLiveActivityOptions, promise: Promise) in
      guard #available(iOS 16.2, *) else {
        promise.resolve(["status": "unavailable"])
        return
      }
      Task { @MainActor in
        let operation = SessionTimerLiveActivityController.shared.enqueueUpdate(options)
        promise.resolve(await operation.value)
      }
    }

    AsyncFunction("clearAsync") { (promise: Promise) in
      guard #available(iOS 16.2, *) else {
        promise.resolve(["status": "unavailable"])
        return
      }
      Task { @MainActor in
        let operation = SessionTimerLiveActivityController.shared.enqueueClear()
        promise.resolve(await operation.value)
      }
    }
  }
}
