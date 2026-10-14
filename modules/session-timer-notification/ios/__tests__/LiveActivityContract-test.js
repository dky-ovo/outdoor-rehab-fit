/** @jest-environment node */
const fs = require("fs");
const path = require("path");
const directory = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(directory, file), "utf8");
const moduleSource = read("SessionTimerNotificationModule.swift");
const controller = read("SessionTimerLiveActivityController.swift");
const attributes = read("LiveActivity/OutdoorFitTimerAttributes.swift");
const widget = read("LiveActivity/OutdoorFitTimerWidget.swift");
const podspec = read("SessionTimerNotification.podspec");

test("iOS module preserves the shared JS contract behind iOS 16.2 runtime guards", () => {
	expect(moduleSource).toContain('Name("SessionTimerNotification")');
	expect(moduleSource).toContain('AsyncFunction("updateAsync")');
	expect(moduleSource).toContain('AsyncFunction("clearAsync")');
	expect(moduleSource.match(/guard #available\(iOS 16\.2, \*\)/g)).toHaveLength(2);
	for (const field of ["timerId", "recordMode", "running", "startedAt", "accumulatedSeconds", "targetDurationSec", "locale", "modeLabel", "statusLabel", "timeLabel", "openLabel", "finishedLabel"]) {
		expect(moduleSource).toMatch(new RegExp(`@Field var ${field}:`));
	}
});

test("app pod keeps old iOS launchable and never compiles the widget entrypoint", () => {
	expect(podspec).toContain("s.platforms = { :ios => '15.1' }");
	expect(podspec).toContain("s.weak_frameworks = 'ActivityKit'");
	const sourceFiles = podspec.split("\n").find((line) => line.includes("s.source_files"));
	expect(sourceFiles).toContain("OutdoorFitTimerAttributes.swift");
	expect(sourceFiles).not.toContain("OutdoorFitTimerWidget.swift");
	expect(widget).toMatch(/@main\s+struct OutdoorFitTimerWidgetBundle/);
});

test("ActivityKit data contains timer identity and display labels only", () => {
	for (const forbidden of ["ownerKey", "phone", "password", "token", "userId", "email"]) {
		expect(attributes).not.toMatch(new RegExp(`var ${forbidden}\\b`));
	}
	expect(attributes).toContain("Codable, Hashable");
	expect(controller).toContain("options.url.utf8.count < 1500");
	expect(controller).toContain(".prefix(60)");
});

test("native updates serialize and suppress recreation after user or system dismissal", () => {
	expect(controller).toContain("@MainActor");
	expect(controller).toContain("_ = await previous?.value");
	expect(controller).toContain("guard request == self.generation");
	expect(controller).toContain("if activity.content.state != state");
	expect(controller).toContain('defaults.string(forKey: trackedTimerKey) == options.timerId');
	expect(controller).toContain('["status": "suppressed"]');
	expect(controller).toContain("UIApplication.shared.applicationState == .active");
	expect(controller).toContain('["status": "deferred"]');
	expect(controller).toContain("pushType: nil");
});

test("countdown reaches bounded zero without a background JS timer or automatic-end claim", () => {
	expect(widget).toContain("Text(timerInterval:");
	expect(widget).toContain("context.state.anchorDate...end");
	expect(widget).toContain('Text("0:00")');
	expect(widget).toContain("context.isStale");
	expect(controller).toContain("? state.endDate : nil");
	expect(controller).toContain("dismissalPolicy: .immediate");
	for (const source of [controller, widget]) {
		expect(source).not.toContain("Timer.scheduledTimer");
		expect(source).not.toContain("AVSpeechSynthesizer");
	}
});

test("deep link remains scoped to the existing timer and cannot include duplicate identity parameters", () => {
	expect(controller).toContain('components.scheme == "myapp"');
	expect(controller).toContain('components.host == "timer-notification"');
	expect(controller).toContain('query.filter { $0.name == "timerId" }.count == 1');
	expect(controller).toContain('query.filter { $0.name == "recordMode" }.count == 1');
	expect(widget.match(/\.widgetURL\(URL\(string: context\.attributes\.url\)\)/g)).toHaveLength(2);
});

test("timer presentation adapts to dark lock screens and preserves hour digits in compact mode", () => {
	expect(widget).toContain("UIColor { traits in");
	expect(widget).toContain("traits.userInterfaceStyle == .dark");
	expect(widget).toContain("foreground: .white");
	expect(widget).toContain("showsHours: true");
	expect(widget).toContain(".monospacedDigit()");
	expect(widget).toContain(".minimumScaleFactor(0.50)");
	expect(widget).toContain(".accessibilityElement(children: .combine)");
	expect(widget).toContain("currentValueLabel: { EmptyView() }");
});

test("compact layouts fit the smallest island slots with stable width across hour and pause transitions", () => {
	const compact = widget.slice(widget.indexOf('} compactTrailing: {'), widget.indexOf('} minimal: {'));
	const fixedFrame = compact.match(/\.frame\(width: ([0-9.]+), height: ([0-9.]+), alignment: \.trailing\)/);
	expect(fixedFrame).not.toBeNull();
	expect(Number(fixedFrame[1])).toBeLessThanOrEqual(52.33);
	expect(Number(fixedFrame[2])).toBeLessThanOrEqual(36.67);
	expect(compact.replace(/\/\/[^\n]*/g, '')).not.toMatch(/minWidth|maxWidth|Date\(\)|duration\(/);
	expect(compact).toContain('alignment: .trailing');
	const minimal = widget.slice(widget.indexOf('} minimal: {'), widget.indexOf('.keylineTint'));
	expect(minimal).toContain('Image(systemName:');
	expect(minimal).not.toMatch(/TimerDigits|Text\(/);
	const leading = widget.slice(widget.indexOf('} compactLeading: {'), widget.indexOf('} compactTrailing: {'));
	expect(leading).toContain('.frame(width: 20, height: 24)');
});

test("expanded and lock-screen clocks own a full row rather than sharing width with localized action labels", () => {
	const expanded = widget.slice(widget.indexOf('DynamicIslandExpandedRegion(.bottom)'), widget.indexOf('} compactLeading: {'));
	expect(expanded).toContain('VStack(alignment: .leading');
	expect(expanded).not.toContain('HStack(');
	expect(expanded).toMatch(/TimerDigits\([^\n]+\)\s+\.frame\(maxWidth: \.infinity, alignment: \.leading\)/);
	const card = widget.slice(widget.indexOf('private struct TimerLockScreenCard'), widget.indexOf('private struct TimerDigits'));
	expect(card).toMatch(/TimerDigits\(context: context, size: 44\)\s+\.frame\(maxWidth: \.infinity, alignment: \.leading\)/);
	expect(card).not.toContain('.frame(maxWidth: 82)');
	const trailing = widget.slice(widget.indexOf('DynamicIslandExpandedRegion(.trailing)'), widget.indexOf('DynamicIslandExpandedRegion(.bottom)'));
	expect(trailing).toContain('.lineLimit(1)');
});

test("native preview fixtures cover difficult sizes without adding a runtime timer or requiring newer preview macros", () => {
	expect(widget).toContain('struct OutdoorFitTimerWidget_Previews: PreviewProvider');
	for (const preview of ['Compact · 24 hours', 'Compact · hour boundary', 'Compact · paused', 'Compact · maximum saved hours',
		'Minimal · icon only', 'Expanded · 24 hours · larger text', 'Lock screen · paused · larger text', 'Lock screen · 中文 · dark']) expect(widget).toContain(preview);
	expect(widget).toContain('elapsed: 31536000, countdown: false');
	expect(widget).toContain('.environment(\\.dynamicTypeSize, .accessibility3)');
	expect(widget).not.toMatch(/#Preview\s*\(/);
});
