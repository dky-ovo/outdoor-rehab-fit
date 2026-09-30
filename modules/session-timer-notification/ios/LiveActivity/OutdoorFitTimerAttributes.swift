import ActivityKit
import Foundation

// This exact source is compiled into both the app pod and the widget target.
// The payload contains timer metadata only, never account or health details.
@available(iOS 16.2, *)
public struct OutdoorFitTimerAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var running: Bool
    public var anchorDate: Date
    public var accumulatedSeconds: Double
    public var targetDurationSec: Double
    public var locale: String
    public var modeLabel: String
    public var statusLabel: String
    public var timeLabel: String
    public var openLabel: String
    public var finishedLabel: String

    public var endDate: Date { anchorDate.addingTimeInterval(targetDurationSec) }
  }

  public var timerId: String
  public var recordMode: String
  public var url: String
}
