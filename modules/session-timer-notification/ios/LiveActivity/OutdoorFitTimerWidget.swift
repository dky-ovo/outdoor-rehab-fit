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
            .font(.caption.weight(.semibold)).foregroundStyle(islandAccent)
            .lineLimit(1).minimumScaleFactor(0.7)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(statusText(context)).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(alignment: .center) {
            TimerDigits(context: context, size: 38, foreground: .white)
            Spacer(minLength: 10)
            Label(context.state.openLabel, systemImage: "arrow.up.right")
              .font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(2)
          }.padding(.vertical, 4)
        }
      } compactLeading: {
        Image(systemName: timerSymbol(context)).foregroundStyle(islandAccent)
          .accessibilityLabel(context.state.modeLabel)
      } compactTrailing: {
        TimerDigits(context: context, size: 13, foreground: .white).frame(minWidth: 42, maxWidth: 82, alignment: .trailing)
      } minimal: {
        Image(systemName: timerSymbol(context)).foregroundStyle(islandAccent)
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

      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 1) {
          Text(context.state.timeLabel).font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
          TimerDigits(context: context, size: 44)
        }
        Spacer(minLength: 2)
        VStack(spacing: 4) {
          Image(systemName: "arrow.up.right").font(.system(size: 16, weight: .semibold))
            .foregroundStyle(timerAccent).frame(width: 35, height: 35)
            .background(timerAccent.opacity(0.10), in: Circle()).accessibilityHidden(true)
          Text(context.state.openLabel).font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
            .lineLimit(2).multilineTextAlignment(.center).frame(maxWidth: 82)
        }
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
      .lineLimit(1).minimumScaleFactor(0.50).foregroundStyle(foreground)
  }

  private func duration(_ value: Double) -> String {
    let total = max(0, Int(value.rounded(.down)))
    let hours = total / 3600
    if hours > 0 { return String(format: "%d:%02d:%02d", hours, (total / 60) % 60, total % 60) }
    return String(format: "%d:%02d", total / 60, total % 60)
  }
}
