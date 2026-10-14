import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

@main
struct OutdoorFitTimerWidgetBundle: WidgetBundle {
  var body: some Widget { OutdoorFitTimerWidget() }
}

struct OutdoorFitTimerWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: OutdoorFitTimerAttributes.self) { context in
      TimerLockScreenCard(context: context)
        .activityBackgroundTint(Color(.secondarySystemBackground))
        .activitySystemActionForegroundColor(.primary)
        .widgetURL(URL(string: context.attributes.url))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Label(context.state.modeLabel, systemImage: timerSymbol(context))
            .font(.system(size: 12, weight: .semibold)).foregroundStyle(islandAccent)
            .lineLimit(1).minimumScaleFactor(0.7)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(statusText(context)).font(.system(size: 11, weight: .semibold))
            .foregroundStyle(.white.opacity(0.8)).lineLimit(1).minimumScaleFactor(0.7)
        }
        DynamicIslandExpandedRegion(.bottom) {
          // A running Text(timerInterval:) asks for the widest possible value.
          // Give the clock its own row below the camera rather than letting a
          // long localized action label compete with its hour digits.
          VStack(alignment: .leading, spacing: 6) {
            TimerDigits(context: context, size: 38, foreground: .white)
              .frame(maxWidth: .infinity, alignment: .leading)
            Label(context.state.openLabel, systemImage: "arrow.up.right")
              .font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.8))
              .lineLimit(1).minimumScaleFactor(0.8)
          }.padding(.vertical, 4).frame(maxWidth: .infinity, alignment: .leading)
        }
      } compactLeading: {
        Image(systemName: timerSymbol(context)).foregroundStyle(islandAccent)
          .font(.system(size: 14, weight: .semibold)).frame(width: 20, height: 24)
          .accessibilityLabel(context.state.modeLabel)
      } compactTrailing: {
        // The smallest supported island offers 52.33 pt on either side.
        // Keep one stable 50 pt slot across 59:59 -> 1:00:00, pause and resume;
        // never derive its width from Date() or the current number of digits.
        TimerDigits(context: context, size: 12, foreground: .white, alignment: .trailing)
          .frame(width: 50, height: 24, alignment: .trailing)
      } minimal: {
        Image(systemName: timerSymbol(context)).foregroundStyle(islandAccent)
          .font(.system(size: 16, weight: .semibold)).frame(width: 22, height: 22)
          .accessibilityLabel(context.state.modeLabel)
      }
      .widgetURL(URL(string: context.attributes.url))
      .keylineTint(islandAccent)
    }
  }
}

// Dynamic Island is always black. The lock-screen card follows system light /
// dark appearance, including Always-On reduced luminance rendering.
private let islandAccent = Color(red: 1.0, green: 0.69, blue: 0.74)
private let timerAccent = Color(uiColor: UIColor { traits in
  traits.userInterfaceStyle == .dark
    ? UIColor(red: 1.0, green: 0.69, blue: 0.74, alpha: 1)
    : UIColor(red: 0.65, green: 0.0, blue: 0.12, alpha: 1)
})

private func timerSymbol(_ context: ActivityViewContext<OutdoorFitTimerAttributes>) -> String {
  context.attributes.recordMode == "countdown" ? "timer" : "stopwatch"
}

private func completed(_ context: ActivityViewContext<OutdoorFitTimerAttributes>) -> Bool {
  context.attributes.recordMode == "countdown" && context.state.running &&
    (context.isStale || context.state.endDate <= Date())
}

private func statusText(_ context: ActivityViewContext<OutdoorFitTimerAttributes>) -> String {
  completed(context) ? context.state.finishedLabel : context.state.statusLabel
}

private struct TimerLockScreenCard: View {
  let context: ActivityViewContext<OutdoorFitTimerAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 9) {
        Image(systemName: timerSymbol(context)).font(.system(size: 16, weight: .semibold))
          .foregroundStyle(timerAccent).frame(width: 32, height: 32)
          .background(timerAccent.opacity(0.10), in: Circle()).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 2) {
          Text("OUTDOOR-FIT").font(.system(size: 9, weight: .bold)).tracking(1.1).foregroundStyle(.secondary)
          Text(context.state.modeLabel).font(.system(size: 13, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        Spacer(minLength: 4)
        HStack(spacing: 4) {
          Circle().fill(completed(context) ? Color.secondary : context.state.running ? timerAccent : Color.orange).frame(width: 5, height: 5)
          Text(statusText(context)).font(.system(size: 11, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 9).padding(.vertical, 6)
        .background(Color.primary.opacity(0.05), in: Capsule())
      }

      VStack(alignment: .leading, spacing: 1) {
        HStack(spacing: 8) {
          Text(context.state.timeLabel).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            .lineLimit(1).minimumScaleFactor(0.8)
          Spacer(minLength: 8)
          Label(context.state.openLabel, systemImage: "arrow.up.right")
            .font(.system(size: 10, weight: .medium)).foregroundStyle(timerAccent)
            .lineLimit(1).minimumScaleFactor(0.8)
        }
        TimerDigits(context: context, size: 44)
          .frame(maxWidth: .infinity, alignment: .leading)
      }

      if context.attributes.recordMode == "countdown" {
        if context.state.running && !completed(context) {
          ProgressView(timerInterval: context.state.anchorDate...context.state.endDate, countsDown: false) { EmptyView() } currentValueLabel: { EmptyView() }
            .labelsHidden().tint(timerAccent).frame(height: 4).accessibilityHidden(true)
        } else {
          ProgressView(value: completed(context) ? 1 : min(1, context.state.accumulatedSeconds / max(1, context.state.targetDurationSec)))
            .tint(timerAccent).frame(height: 4).accessibilityHidden(true)
        }
      }
    }
    .padding(.horizontal, 16).padding(.vertical, 13)
    .accessibilityElement(children: .combine)
  }
}

private struct TimerDigits: View {
  let context: ActivityViewContext<OutdoorFitTimerAttributes>
  let size: CGFloat
  var foreground: Color = .primary
  var alignment: TextAlignment = .leading

  @ViewBuilder private var value: some View {
    if completed(context) {
      Text("0:00")
    } else if !context.state.running {
      Text(duration(context.attributes.recordMode == "countdown"
        ? context.state.targetDurationSec - context.state.accumulatedSeconds : context.state.accumulatedSeconds))
    } else {
      // SwiftUI's system-managed timer continues without waking React Native.
      // A bounded countdown stops at zero. The system refreshes its status via
      // staleDate; that refresh is not a promise of a precise background callback.
      let end = context.attributes.recordMode == "countdown" ? context.state.endDate : context.state.anchorDate.addingTimeInterval(31536000)
      Text(timerInterval: context.state.anchorDate...end, countsDown: context.attributes.recordMode == "countdown", showsHours: true)
    }
  }

  var body: some View {
    value.font(.system(size: size, weight: .bold, design: .rounded)).monospacedDigit()
      .lineLimit(1).minimumScaleFactor(0.50).multilineTextAlignment(alignment).foregroundStyle(foreground)
  }

  private func duration(_ value: Double) -> String {
    let total = max(0, Int(value.rounded(.down)))
    let hours = total / 3600
    if hours > 0 { return String(format: "%d:%02d:%02d", hours, (total / 60) % 60, total % 60) }
    return String(format: "%d:%02d", total / 60, total % 60)
  }
}

// Native Xcode preview matrix. These are fixture states only, never app data.
// PreviewProvider also supports the extension's iOS 16.2 minimum (unlike newer
// #Preview macros); verify on a 393 pt iPhone and with larger accessibility text.
@available(iOSApplicationExtension 16.2, *)
struct OutdoorFitTimerWidget_Previews: PreviewProvider {
  private static func attributes(_ mode: String = "countdown") -> OutdoorFitTimerAttributes {
    OutdoorFitTimerAttributes(timerId: "preview", recordMode: mode,
      url: "myapp://timer-notification?timerId=preview&recordMode=\(mode)")
  }

  private static func state(_ english: Bool = false, running: Bool = true,
                            target: Double = 86400, elapsed: Double = 0,
                            countdown: Bool = true) -> OutdoorFitTimerAttributes.ContentState {
    OutdoorFitTimerAttributes.ContentState(running: running,
      anchorDate: Date().addingTimeInterval(-elapsed), accumulatedSeconds: elapsed,
      targetDurationSec: target, locale: english ? "en" : "zh",
      modeLabel: english ? (countdown ? "Countdown timer" : "Count-up timer") : (countdown ? "倒數計時器" : "正數計時器"),
      statusLabel: english ? (running ? "Running" : "Paused") : (running ? "計時中" : "已暫停"),
      timeLabel: english ? (countdown ? "Remaining" : "Elapsed") : (countdown ? "剩餘時間" : "已計時間"),
      openLabel: english ? "Tap to open timer" : "點按返回計時器",
      finishedLabel: english ? "Finished" : "計時結束")
  }

  static var previews: some View {
    Group {
      attributes().previewContext(state(), viewKind: .dynamicIsland(.compact))
        .previewDisplayName("Compact · 24 hours · 中文")
      attributes().previewContext(state(true, target: 3600), viewKind: .dynamicIsland(.compact))
        .previewDisplayName("Compact · hour boundary · English")
      attributes().previewContext(state(true, running: false, elapsed: 61), viewKind: .dynamicIsland(.compact))
        .previewDisplayName("Compact · paused · English")
      attributes("countup").previewContext(state(true, running: false, elapsed: 31536000, countdown: false), viewKind: .dynamicIsland(.compact))
        .previewDisplayName("Compact · maximum saved hours")
      attributes().previewContext(state(), viewKind: .dynamicIsland(.minimal))
        .previewDisplayName("Minimal · icon only")
      attributes().previewContext(state(true), viewKind: .dynamicIsland(.expanded))
        .environment(\.dynamicTypeSize, .accessibility3)
        .previewDisplayName("Expanded · 24 hours · larger text")
      attributes().previewContext(state(true, running: false, elapsed: 61), viewKind: .content)
        .environment(\.dynamicTypeSize, .accessibility3)
        .previewDisplayName("Lock screen · paused · larger text")
      attributes().previewContext(state(), viewKind: .content)
        .environment(\.colorScheme, .dark)
        .previewDisplayName("Lock screen · 中文 · dark")
    }
  }
}
